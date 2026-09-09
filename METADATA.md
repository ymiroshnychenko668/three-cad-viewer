# Component metadata inspector

The fork adds **Свойства** (Properties) and **Журнал** (History) tabs in the
lower navigation panel, underneath the Tree/Clip/Material area. The existing
Info journal is preserved. Select a component in the tree or click its geometry
to inspect its metadata; this does not require a measurement tool.
In CAD mode without an active tool, clicking also updates the tree highlight
and bounding box to that component; clicking empty space clears them. Repeated
clicks keep the same component selected and do not move the camera.

Pass an optional `metadata` JSON object on any hierarchy node in the viewer's
`Shapes` input, alongside `id`, `name`, `parts` or `shape`. Assembly nodes and
leaf nodes both support metadata. Instanced geometry decoding preserves it.

```javascript
{
  id: "/Assembly/Display",
  name: "Display",
  parts: [],
  metadata: {
    schema_version: 1,
    id: "step:source-revision:component-id",
    identity_scope: "source_revision",
    instance_id: "wall-case/display",
    source: { filename: "display.step", sha256: "...", schema: "AP214" },
    original: { name: "Manufacturer name" },
    properties: { material: null },
    project: { purpose: "main display" },
    current: { name: "Display" },
    computed: { volume_mm3: 1200 },
    coverage: { read: ["names", "colors"], warnings: [] }
  }
}
```

The object is deliberately open-ended. Unknown keys, nested dictionaries,
lists, booleans, numbers and nulls remain inspectable. Large nested tables expand
lazily. Values are rendered as text, not HTML. The inspector does not invent
source properties or derive engineering material from renderer appearance.

`original`, `current`, `computed`, `project` and `coverage` get descriptive
section headings, while the remaining data retains its original field names.
Source metadata can describe a STEP file or Python code that generated the part.
Vendor properties in `properties.named_data` (and instance overrides) are
presented directly: ProductID, Description and other values are readable
immediately after selecting a component. Typed namespaces remain in field labels
and tooltips, so identical keys in different typed groups remain distinct.
Engineering properties come first; original XDE structure, source provenance
and scene bounds remain available as collapsed secondary sections.

**Копировать ссылку** copies JSON with the optional metadata `id`, `instance_id`,
`identity_scope`, source provenance and full `viewer_path`. A source ID may occur
multiple times when the same source part is instantiated repeatedly; use the
project `instance_id` to distinguish these placements. A viewer path is a
session/model identifier and is never presented as a persistent topology ID.

The inspector matches exact input node IDs; it does not parse slashes in names
or interpolate IDs into selectors. Model replacement/clear invalidates the
selection. For older callers without metadata, the inspector displays the
current name, path, appearance and available bounds, with an explicit message
that STEP metadata was not supplied.

This is a read-only component inspector. It does not write annotations, infer
geometric feature identity or modify STEP files.

Validation commands:

```bash
yarn test:run tests/integration/metadata.test.js tests/integration/display.test.js tests/unit/decode-instances.test.js --testTimeout=30000
./node_modules/.bin/tsc --noEmit
yarn build
```
