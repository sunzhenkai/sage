# Generic Agent Platform Runtime

Status: **draft**; admission: **blocked**.

```mermaid
flowchart LR
  actor_caller["actor.caller"]
  broker_capability["broker.capability"]
  broker_context["broker.context"]
  broker_model["broker.model"]
  control_admission["control.admission"]
  control_release["control.release"]
  coordinator_lifecycle["coordinator.lifecycle"]
  engine_pi["engine.pi"]
  engine_reference["engine.reference"]
  host_durable["host.durable"]
  host_interactive["host.interactive"]
  projection_product["projection.product"]
  provider_external["provider.external"]
  reconciler_authority["reconciler.authority"]
  runtime_kernel["runtime.kernel"]
  service_approval["service.approval"]
  service_identity["service.identity"]
  service_kms["service.kms"]
  service_observability["service.observability"]
  service_policy["service.policy"]
  service_secret["service.secret"]
  store_artifact["store.artifact"]
  store_checkpoint["store.checkpoint"]
  store_consumption["store.consumption"]
  store_effect["store.effect"]
  store_history["store.history"]
  control_admission -->|spec| coordinator_lifecycle
  control_admission -->|authenticate| service_identity
  control_admission -->|spec| host_interactive
  store_artifact -->|derive| projection_product
  actor_caller -->|request| control_admission
  broker_capability -->|egress| provider_external
  broker_capability -->|lease-ref| service_secret
  store_checkpoint -->|derive| projection_product
  coordinator_lifecycle -->|authority-write| store_history
  coordinator_lifecycle -->|dispatch| host_durable
  coordinator_lifecycle -->|bounded-telemetry| service_observability
  host_durable -->|invoke| runtime_kernel
  store_effect -->|derive| projection_product
  store_history -->|derive| projection_product
  host_interactive -->|invoke| runtime_kernel
  runtime_kernel -->|authority-port| store_artifact
  runtime_kernel -->|candidate| store_checkpoint
  runtime_kernel -->|reserve-commit| store_consumption
  runtime_kernel -->|claim-commit| store_effect
  runtime_kernel -->|adapter| engine_pi
  runtime_kernel -->|authorize| service_policy
  runtime_kernel -->|test-adapter| engine_reference
  broker_model -->|egress| provider_external
  engine_pi -->|callback| broker_capability
  engine_pi -->|callback| broker_context
  engine_pi -->|callback| broker_model
  service_policy -->|verify| service_approval
  reconciler_authority -->|read| store_history
  reconciler_authority -->|repair| projection_product
  control_release -->|immutable-ref| control_admission
  runtime_kernel -->|bounded-telemetry| service_observability
  service_secret -->|key-ref| service_kms
  store_consumption -->|derive| projection_product
```

Model digest: `sha256:830d4046e44bcef1a1aad015eaaa6d7b5e0e0131569b4e1ec11c9459b485445a`
DSL digest: `sha256:6ec4daedc6517523a77591d7ea0f6479af86665273d6fc1b3bdf33b0ffd94009`
