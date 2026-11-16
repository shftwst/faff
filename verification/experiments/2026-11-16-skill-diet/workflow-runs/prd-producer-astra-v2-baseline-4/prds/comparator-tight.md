# Product goal
Provide a health endpoint.

## Implementation constraints
Use Node 22, PostgreSQL and GET /health.

## Done
GET /health MUST return HTTP 200 in under 100 ms for each of 100 consecutive local requests.
