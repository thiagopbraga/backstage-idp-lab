# ${{ values.name }}

${{ values.description }}

- Owner: `${{ values.owner }}`
- Tier: `${{ values.tier }}` · Criticality: `${{ values.criticality }}` · Data classification: `${{ values.dataClassification }}`

## Run

```bash
npm install
npm run start:dev    # http://localhost:3000/health
npm test
docker build -t ${{ values.name }} .
```
