# @internal/backstage-plugin-code-quality

Frontend plugin (new frontend system) for the code-quality backend.

- `codeQualityApiRef` + `CodeQualityClient` (DiscoveryApi + FetchApi), registered with `ApiBlueprint`.
- `entity-card:code-quality/overview` (`EntityCardBlueprint`): SonarQube quality gate and metrics, plus the latest GitHub Actions runs. It only renders for entities with `sonarqube.org/project-key` or `github.com/project-slug`.

The app discovers it automatically (`app.packages: all`). To turn the card off without code changes:

```yaml
app:
  extensions:
    - entity-card:code-quality/overview: false
```
