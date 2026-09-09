# Tenet Whiteboard managed app configuration

Bundle identifier: `ai.truemade.tenet.whiteboard`

Assign Tenet Whiteboard as a managed app in the district MDM, then supply one
of the plist dictionaries in this directory as its managed app configuration.
MDM products label this field differently, commonly Managed App Configuration,
AppConfig, or Configuration Dictionary.

Do not install these plist files as standalone configuration profiles. They are
configuration dictionaries for the managed application assignment.

## Supported keys

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `studentRuleProfile` | string | yes | Server-owned bootstrap profile. Allowed values are `district` and `spanish`. |
| `requireManagedConfiguration` | boolean | yes | Keep `true` on student deployments. The app refuses an unmanaged launch. |
| `pencilKitEnabled` | boolean | no | Enables the native Apple Pencil studio. Defaults to `true`. |
| `fingerDrawingEnabled` | boolean | no | Allows finger input inside PencilKit. Defaults to `false`. |

The configuration intentionally has no arbitrary server URL, API key, role,
rule text, or bypass field. A device administrator chooses a bounded bootstrap
profile; the Tenet service remains authoritative.

## Class-level rules

`studentRuleProfile` is not the final classroom policy. After authentication,
the native session binds the student identity and selected bootstrap profile.
The intended production request chain is:

```text
student identity
  -> Tenet rule service resolves district, enrollment, class, and current rules
  -> Tenet issues a short-lived signed policy context
  -> Gateway validates that context before each governed request
```

The Gateway must fail closed when the student cannot be resolved, the policy is
expired, or the class rules are unavailable. MDM configuration must never be
promoted into the class-rule authority.

## Files

- `district.plist`: standard district student protections and Socratic behavior.
- `spanish.plist`: district protections plus Spanish-immersion behavior.
- `schema.json`: strict machine-readable validation schema for MDM tooling.
