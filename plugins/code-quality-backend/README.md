# @internal/backstage-plugin-code-quality-backend

Backend plugin (new backend system) mounted at `/api/code-quality`. It reads the
`sonarqube.org/project-key` and `github.com/project-slug` annotations of a catalog
entity and returns a combined report from the **SonarQube Web API** (quality gate,
coverage, bugs, vulnerabilities, code smells, hotspots, duplication) and the
**GitHub REST API** (repository metadata + latest Actions runs).

```
GET /api/code-quality/report?entityRef=component:default/claims-api
```

- Services: `coreServices.rootConfig`, `logger`, `cache`, `httpAuth`, `httpRouter` and `catalogServiceRef`.
- The entity is fetched with the caller's credentials, so catalog read permissions apply.
- Each section is cached for `codeQuality.cacheTtlSeconds` (default 300s) and failures are isolated per section.
- **Mock mode**: with no tokens (or `codeQuality.mode: mock`) deterministic fake data is returned, so the demo runs offline.

```yaml
codeQuality:
  mode: auto # auto | mock | live
  cacheTtlSeconds: 300
  sonarqube:
    baseUrl: https://sonarcloud.io
    token: ${SONARQUBE_TOKEN}
  github:
    apiBaseUrl: https://api.github.com # token reused from integrations.github
```

Run standalone with `yarn start` in this folder (mock auth + in-memory catalog, see `dev/index.ts`).
