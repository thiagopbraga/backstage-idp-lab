# @internal/backstage-plugin-permission-backend-module-fastflow-policy

Permission backend module that installs `FastFlowPermissionPolicy` through
`policyExtensionPoint` (new backend system). It replaces the allow-all policy.

- Reads stay open; unknown permissions are allowed.
- `catalog.entity.delete` / `catalog.entity.refresh`: CONDITIONAL on `isEntityOwner`.
- `catalog.location.delete`, `catalog.ingestion.manage`, `scaffolder.template.management`: platform admins only.
- `scaffolder.task.create` / `scaffolder.template.dry-run`: team members only.
- `scaffolder.action.execute`: owner-scoped actions (default `fastflow:governance:validate`)
  only run when their `owner` input is one of the initiator's groups.
- `scaffolder.task.read` / `scaffolder.task.cancel`: CONDITIONAL on `isTaskOwner`.
- Members of `fastflow.permission.platformAdminGroups` (default `group:default/fastflow`) are allowed everything.

```ts
backend.add(
  import(
    '@internal/backstage-plugin-permission-backend-module-fastflow-policy'
  ),
);
```

See the repository README (stage 4) and `docs/identity-and-sso.md`.
