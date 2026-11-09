# Identidade, ownership e SSO (Entra ID / Keycloak)

Este documento explica como a identidade de quem está logado vira **ownership** no Backstage, que é o insumo da `FastFlowPermissionPolicy` (etapa 4). Ele cobre como o laboratório faz isso hoje (guest provider) e como o mesmo contrato é atendido em produção com Microsoft Entra ID ou Red Hat Build of Keycloak (RHBK).

## O contrato: `userEntityRef` + `ownershipEntityRefs`

Todo token de usuário emitido pelo `auth-backend` carrega:

```json
{
  "sub": "user:default/ana.souza",
  "ent": ["user:default/ana.souza", "group:default/claims-squad"]
}
```

- `sub` → `userEntityRef`: a entidade `User` do catálogo.
- `ent` → `ownershipEntityRefs`: o próprio usuário + os `Group` de `spec.memberOf` (por padrão só a filiação **direta**; grupos pais não entram — o `AuthOwnershipResolver` permite mudar isso).

A policy não lê nada de IdP diretamente: ela consulta `coreServices.userInfo` (`ownershipEntityRefs`) e devolve decisões condicionais (`isEntityOwner`, `isTaskOwner`, `hasStringProperty owner`). Quem decide se o recurso pertence ao usuário é o plugin dono do recurso (catálogo/scaffolder), comparando com a relação `ownedBy`. **Trocar o IdP não muda a policy** — só muda como `sub`/`ent` são produzidos.

## Hoje: guest provider (somente demo)

```yaml
auth:
  providers:
    guest:
      userEntityRef: ${BACKSTAGE_GUEST_USER:-user:default/ana.souza}
```

O guest provider faz `signInWithCatalogUser` com a entidade configurada, então o token já sai com os grupos de `memberOf` resolvidos a partir de `examples/org.yaml` — exatamente como um IdP real faria. Para trocar de identidade, reinicie o backend com outra variável:

| `BACKSTAGE_GUEST_USER`      | Grupo          | O que a policy permite                                       |
| --------------------------- | -------------- | ------------------------------------------------------------ |
| `user:default/ana.souza`    | `claims-squad` | Escrever/refresh/delete em `claims-*`; scaffold para o squad |
| `user:default/bruno.lima`   | `policy-squad` | Escrever/refresh/delete em `policy-*`; scaffold para o squad |
| `user:default/thiago.braga` | `fastflow`     | Tudo (platform admin / break-glass)                          |

```bash
BACKSTAGE_GUEST_USER=user:default/bruno.lima docker compose up -d        # container
BACKSTAGE_GUEST_USER=user:default/bruno.lima yarn start                  # dev
curl -s -H 'X-Requested-With: XMLHttpRequest' \
  http://localhost:7007/api/auth/guest/refresh | jq .backstageIdentity.identity
```

As chaves de assinatura ficam no Postgres (`backstage_plugin_auth`), então um token emitido antes do restart continua válido até expirar (1h). É assim que `scripts/smoke-permissions.sh` testa duas identidades no mesmo backend.

> O guest provider nunca deve ir para produção: `app-config.docker.yaml` só o habilita fora de desenvolvimento para a demo (`dangerouslyAllowOutsideDevelopment`).

## Produção: duas peças separadas

1. **Ingestão de Users/Groups no catálogo** (Entity Provider) — de onde vem `memberOf`.
2. **Sign-in resolver** — como o usuário autenticado no IdP é ligado a uma entidade `User`.

A recomendação é **o catálogo como fonte de verdade de grupos**: o IdP autentica, o resolver encontra o `User`, e os grupos vêm do `memberOf` ingerido. Assim a policy, a página do time, o filtro "Owned" e o `isEntityOwner` enxergam a mesma coisa, e uma mudança de time no diretório reflete no próximo ciclo de ingestão.

### Microsoft Entra ID

**Ingestão** — `@backstage/plugin-catalog-backend-module-msgraph`:

```yaml
catalog:
  providers:
    microsoftGraphOrg:
      default:
        tenantId: ${AZURE_TENANT_ID}
        clientId: ${AZURE_CLIENT_ID}
        clientSecret: ${AZURE_CLIENT_SECRET}
        user:
          filter: accountEnabled eq true and userType eq 'Member'
        group:
          # só os grupos de segurança que representam times no Backstage
          filter: securityEnabled eq true and startswith(displayName, 'sg-backstage-')
        schedule:
          frequency: { minutes: 30 }
          timeout: { minutes: 5 }
```

Os `User` ganham a anotação `graph.microsoft.com/user-id` e `memberOf` vem da filiação nos grupos. Para que o nome do grupo no catálogo seja `claims-squad` (e não `sg-backstage-claims-squad`), usa-se um transformer via `microsoftGraphOrgEntityProviderTransformExtensionPoint`. A app registration precisa de `User.Read.All` e `GroupMember.Read.All` (application permissions).

**Sign-in** — `@backstage/plugin-auth-backend-module-microsoft-provider`:

```yaml
auth:
  environment: production
  providers:
    microsoft:
      production:
        clientId: ${AZURE_CLIENT_ID}
        clientSecret: ${AZURE_CLIENT_SECRET}
        tenantId: ${AZURE_TENANT_ID}
        domainHint: ${AZURE_TENANT_ID}
        signIn:
          resolvers:
            - resolver: userIdMatchingUserEntityAnnotation # object id -> graph.microsoft.com/user-id
            - resolver: emailMatchingUserEntityAnnotation
```

**E o claim `groups` do token?** O Entra pode emitir `groups` (object IDs) ou `roles` (app roles) no ID token. Dá para usar, mas com ressalvas: acima de ~200 grupos o token traz um _overage claim_ em vez da lista (é preciso chamar o Graph), e os valores são GUIDs. Se a empresa preferir esse modelo, o caminho é um **resolver customizado** (módulo do `auth` com `createOAuthProviderFactory` + `signInResolver`) que mapeia GUID/app role → `group:default/<time>` e chama `ctx.signInWithCatalogUser(...)`. Ver o esqueleto mais abaixo.

### Red Hat Build of Keycloak (RHBK)

**Ingestão** — `@backstage-community/plugin-catalog-backend-module-keycloak` (o mesmo usado pelo Red Hat Developer Hub):

```yaml
catalog:
  providers:
    keycloakOrg:
      default:
        baseUrl: https://sso.example.com
        loginRealm: fastflow
        realm: fastflow
        clientId: ${KEYCLOAK_CLIENT_ID}
        clientSecret: ${KEYCLOAK_CLIENT_SECRET}
        schedule:
          frequency: { minutes: 30 }
          timeout: { minutes: 3 }
```

O service account do client precisa das roles `view-users`, `query-users`, `query-groups` (realm-management). Grupos do realm viram `Group` e a filiação vira `memberOf`.

**Sign-in** — provider OIDC genérico (`@backstage/plugin-auth-backend-module-oidc-provider`):

```yaml
auth:
  environment: production
  providers:
    oidc:
      production:
        metadataUrl: https://sso.example.com/realms/fastflow/.well-known/openid-configuration
        clientId: ${KEYCLOAK_CLIENT_ID}
        clientSecret: ${KEYCLOAK_CLIENT_SECRET}
        prompt: auto
        signIn:
          resolvers:
            - resolver: emailMatchingUserEntityProfileEmail
            - resolver: emailLocalPartMatchingUserEntityName
```

**Claims de grupos/roles no Keycloak**: um mapper _Group Membership_ no client scope emite `groups: ["/fastflow/claims-squad"]` (com ou sem _full group path_); roles de realm vêm em `realm_access.roles` e de client em `resource_access.<client>.roles`. Mesma recomendação: preferir os grupos ingeridos no catálogo; usar claims só via resolver customizado.

### Esqueleto de resolver customizado (claims → grupos)

Quando os grupos **precisam** vir do token (ex.: times que não existem no diretório), um módulo do `auth` pode emitir o token com `ent` montado a partir dos claims — e ainda exigir que o `User` exista no catálogo:

```ts
// plugins/auth-backend-module-fastflow-oidc/src/module.ts (exemplo, não incluído no lab)
export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'fastflow-oidc',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'oidc',
          factory: createOAuthProviderFactory({
            authenticator: oidcAuthenticator,
            async signInResolver({ profile, result }, ctx) {
              const claims = decodeJwt(result.session.idToken!); // jose
              const teams = ((claims.groups as string[]) ?? [])
                .filter(g => g.startsWith('/fastflow/'))
                .map(g => `group:default/${g.split('/').pop()}`);
              const { entity } = await ctx.findCatalogUser({
                filter: { 'spec.profile.email': profile.email! },
              });
              const userRef = stringifyEntityRef(entity);
              return ctx.issueToken({
                claims: { sub: userRef, ent: [userRef, ...teams] },
              });
            },
          }),
        });
      },
    });
  },
});
```

Trade-off: grupos vindos do token só mudam no próximo login e não aparecem como relações no catálogo (a página do time não lista o membro). Por isso o lab usa o modelo "catálogo como fonte de verdade".

### Frontend

No new frontend system, o provider escolhido precisa aparecer na página de login (`SignInPageBlueprint` com `microsoftAuthApiRef` ou uma `ApiBlueprint` registrando a API OIDC) e o guest sai da lista. Isso fica fora do escopo do lab, que roda 100% offline.
