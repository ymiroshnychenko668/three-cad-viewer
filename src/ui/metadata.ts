import type { Shapes } from "../core/types.js";

let nextPanelId = 0;

const sectionNames: Record<string, string> = {
  source: "Источник",
  original: "Исходные свойства · из STEP",
  current: "Текущие свойства · проект",
  properties: "Свойства",
  instance_properties: "Свойства экземпляра · из STEP",
  project: "Свойства проекта",
  computed: "Геометрия · вычислено",
  coverage: "Полнота импорта",
  annotations: "Аннотации · проект",
};

/** Metadata stays arbitrary JSON: unfamiliar exporter fields must remain visible. */
function fields(value: unknown, flattenNamedData = false): HTMLElement {
  const list = document.createElement("dl");
  list.className = "tcv_metadata_fields";
  if (value === null || typeof value !== "object") {
    const text = document.createElement("dd");
    text.textContent = value === null ? "null" : String(value);
    list.append(text);
    return list;
  }
  const entries = Object.entries(value);
  if (!entries.length) {
    const text = document.createElement("dd");
    text.textContent = Array.isArray(value) ? "[]" : "{}";
    list.append(text);
  }
  for (const [key, item] of entries) {
    if (
      flattenNamedData &&
      key === "named_data" &&
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Object.keys(item).length
    ) {
      // Native typed groups are useful provenance, but not useful navigation.
      // Show the vendor keys directly and retain the exact group in each label.
      for (const [type, group] of Object.entries(item)) {
        if (
          group &&
          typeof group === "object" &&
          !Array.isArray(group) &&
          Object.keys(group).length
        ) {
          const typed = fields(group);
          for (const label of typed.querySelectorAll(":scope > dt")) {
            const name = label.textContent;
            label.setAttribute("title", `named_data.${type}.${name}`);
            label.textContent = `${name} · ${type}`;
          }
          list.append(...Array.from(typed.children));
        } else {
          list.append(
            ...Array.from(fields({ [`named_data.${type}`]: group }).children),
          );
        }
      }
      continue;
    }
    const label = document.createElement("dt");
    label.textContent = key;
    const content = document.createElement("dd");
    if (
      Array.isArray(item) &&
      item.length <= 12 &&
      item.every((entry) => entry === null || typeof entry !== "object")
    ) {
      content.textContent = JSON.stringify(item);
    } else if (item !== null && typeof item === "object") {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = Array.isArray(item)
        ? `Список · ${item.length}`
        : `Поля · ${Object.keys(item).length}`;
      details.append(summary);
      // Geometry-level tables can be large. Expand lazily without discarding data.
      const populate = (): void => {
        if (details.open && details.childElementCount === 1) {
          details.append(fields(item));
        }
      };
      details.addEventListener("toggle", populate);
      populate();
      content.append(details);
    } else {
      content.textContent = item === null ? "null" : String(item);
    }
    list.append(label, content);
  }
  return list;
}

/** Current component properties, in the lower navigation panel beside Info history. */
export class MetadataInspector {
  private nodes = new Map<string, Shapes>();
  private panel: HTMLElement;
  private history: HTMLElement;
  private tabs: HTMLButtonElement[];
  private selectedId: string | null = null;
  private disposed = false;
  private listeners: (() => void)[] = [];

  constructor(container: HTMLElement) {
    this.panel = container.querySelector(".tcv_metadata_panel")!;
    this.history = container.querySelector(".tcv_info_history_panel")!;
    this.tabs = [
      container.querySelector(".tcv_info_metadata_tab")!,
      container.querySelector(".tcv_info_history_tab")!,
    ];
    const id = `tcv-inspector-${nextPanelId++}`;
    [this.panel, this.history].forEach((panel, index) => {
      const tab = this.tabs[index];
      panel.id = `${id}-panel-${index}`;
      tab.id = `${id}-tab-${index}`;
      tab.setAttribute("aria-controls", panel.id);
      panel.setAttribute("aria-labelledby", tab.id);
      const click = (): void => this.activate(index);
      const keydown = (event: KeyboardEvent): void => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const target =
          event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
        this.activate(target);
        this.tabs[target].focus();
      };
      tab.addEventListener("click", click);
      tab.addEventListener("keydown", keydown);
      this.listeners.push(() => {
        tab.removeEventListener("click", click);
        tab.removeEventListener("keydown", keydown);
      });
    });
    this.activate(0);
    this.select(null);
  }

  private activate(index: number): void {
    this.tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    this.panel.hidden = index !== 0;
    this.history.hidden = index !== 1;
  }

  /** Replacing the model always invalidates the previous selection, even for reused paths. */
  setModel(root: Shapes | null): void {
    this.nodes.clear();
    const visit = (node: Shapes): void => {
      this.nodes.set(node.id, node);
      node.parts?.forEach(visit);
    };
    if (root) visit(root);
    this.select(null);
  }

  /** Exact lookup: slashes/Unicode in names are data, never CSS selectors or ID delimiters. */
  select(id: string | null, worldBounds?: Record<string, unknown>): void {
    this.selectedId = id;
    this.panel.replaceChildren();
    this.panel.scrollTop = 0;
    const node = id === null ? undefined : this.nodes.get(id);
    if (!node) {
      const hint = document.createElement("p");
      hint.className = "tcv_metadata_hint";
      hint.textContent =
        id === null
          ? "Выберите компонент в дереве или на модели."
          : "Свойства этого элемента недоступны. Выберите компонент в дереве.";
      this.panel.append(hint);
      return;
    }

    const title = document.createElement("h3");
    title.className = "tcv_metadata_title";
    title.textContent = node.name;
    this.panel.append(title);

    const metadata = node.metadata ?? {};
    const original = metadata.original;
    if (
      original &&
      typeof original === "object" &&
      "name" in original &&
      typeof original.name === "string" &&
      original.name &&
      original.name !== node.name
    ) {
      const name = document.createElement("p");
      name.className = "tcv_metadata_hint";
      name.textContent = `Исходное имя: ${original.name}`;
      this.panel.append(name);
    }
    const identity = typeof metadata.id === "string" ? metadata.id : null;
    const instanceId =
      typeof metadata.instance_id === "string" ? metadata.instance_id : null;
    const hint = document.createElement("p");
    hint.className = "tcv_metadata_hint";
    hint.textContent = instanceId
      ? `Экземпляр: ${instanceId}`
      : identity
        ? metadata.identity_scope === "source_revision"
          ? "Идентификатор привязан к версии STEP."
          : "Идентификатор задан в метаданных."
        : "ID метаданных не задан. Путь просмотра действует в текущей модели.";
    hint.title = identity ?? "";
    this.panel.append(hint);

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "tcv_metadata_copy";
    copy.textContent = "Копировать ссылку";
    copy.title = "ID, источник и полный путь компонента в формате JSON";
    copy.addEventListener("click", async () => {
      const reference = {
        ...(identity ? { id: identity } : {}),
        ...(instanceId ? { instance_id: instanceId } : {}),
        ...(metadata.identity_scope
          ? { identity_scope: metadata.identity_scope }
          : {}),
        ...(metadata.source ? { source: metadata.source } : {}),
        viewer_path: node.id,
      };
      try {
        await navigator.clipboard.writeText(JSON.stringify(reference, null, 2));
        if (!this.disposed && this.selectedId === id)
          copy.textContent = "Скопировано";
      } catch {
        if (!this.disposed && this.selectedId === id)
          copy.textContent = "Не удалось скопировать";
      }
    });
    this.panel.append(copy);

    // Put useful engineering/vendor fields ahead of transport and topology details.
    const primaryKeys = [
      "properties",
      "instance_properties",
      "project",
      "current",
      "annotations",
      "computed",
    ];
    for (const key of primaryKeys) {
      if (Object.prototype.hasOwnProperty.call(metadata, key)) {
        this.section(
          sectionNames[key] ?? key,
          metadata[key],
          true,
          key === "properties" || key === "instance_properties",
        );
      }
    }

    this.section(
      "В просмотрщике · текущая модель",
      {
        name: node.name,
        viewer_path: node.id,
        kind: node.parts ? "assembly" : (node.subtype ?? node.type ?? "shape"),
        ...(node.color !== undefined ? { display_color: node.color } : {}),
        ...(node.alpha !== undefined ? { opacity: node.alpha } : {}),
        ...(node.loc ? { placement: node.loc } : {}),
      },
      false,
    );
    if (worldBounds) {
      this.section("Габариты · текущая сцена", worldBounds, false);
    } else if (node.bb) {
      this.section("Габариты · из входных данных", node.bb, false);
    }
    if (!Object.keys(metadata).length) {
      const empty = document.createElement("p");
      empty.className = "tcv_metadata_hint";
      empty.textContent = "Метаданные STEP для этого компонента не переданы.";
      this.panel.append(empty);
    }
    const technicalKeys = [
      "schema_version",
      "id",
      "instance_id",
      "identity_scope",
      "kind",
      "topology",
      "coverage",
      "document",
      "original",
    ];
    const remaining = Object.entries(metadata).filter(
      ([key]) => !primaryKeys.includes(key),
    );
    remaining.sort(
      ([a], [b]) =>
        Number(technicalKeys.includes(a)) - Number(technicalKeys.includes(b)),
    );
    for (const [key, value] of remaining) {
      // Do not suppress schema/version/id or unfamiliar fields: this is an inspector.
      this.section(sectionNames[key] ?? key, value, false);
    }
  }

  private section(
    title: string,
    value: unknown,
    open: boolean,
    flattenNamedData = false,
  ): void {
    const section = document.createElement("details");
    section.className = "tcv_metadata_section";
    section.open = open;
    const summary = document.createElement("summary");
    summary.textContent = title;
    section.append(summary);
    const populate = (): void => {
      if (section.open && section.childElementCount === 1)
        section.append(fields(value, flattenNamedData));
    };
    section.addEventListener("toggle", populate);
    populate();
    this.panel.append(section);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.forEach((remove) => remove());
    this.listeners = [];
    this.nodes.clear();
    this.panel.replaceChildren();
  }
}
