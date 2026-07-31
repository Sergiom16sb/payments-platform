"""pytest tests for the payments processor.

Coverage:
  - health endpoint: 200 + uptime shape
  - /process happy path: 200 + processorRef + status
  - validation: bad currency / negative amount / missing fields -> 422
  - distribution: APPROVED ratio is roughly 0.8 over a large sample
  - reason: REJECTED responses always include a non-null reason
"""