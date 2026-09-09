import { afterEach, describe, expect, it, vi } from "vitest";
import { setupViewer, cleanup } from "../helpers/setup.js";
import { loadExample } from "../helpers/snapshot.js";
import { PickingController } from "../../src/core/picking-controller.js";
import { Info } from "../../src/ui/info.js";
import { Box3, Vector3 } from "three";

let context;
afterEach(() => {
  if (context) cleanup(context);
  context = null;
  vi.restoreAllMocks();
});

const panel = () => context.container.querySelector(".tcv_metadata_panel");
const expandAll = () => {
  // Rendering is lazy, so each expansion can introduce more details nodes.
  for (let i = 0; i < 8; i++) {
    panel()
      .querySelectorAll("details")
      .forEach((item) => {
        item.open = true;
        item.dispatchEvent(new Event("toggle"));
      });
  }
};

describe("Metadata inspector", () => {
  it("places accessible tabs below the tree and retains the info history", () => {
    context = setupViewer();
    const { container, display } = context;
    const tabs = container.querySelectorAll(".tcv_cad_info_wrapper [role=tab]");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toBe("Свойства");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    display.addInfoHtml("Existing journal entry");
    tabs[1].click();
    expect(panel().hidden).toBe(true);
    expect(container.querySelector(".tcv_info_history_panel").hidden).toBe(
      false,
    );
    expect(display.cadInfo.textContent).toContain("Existing journal entry");
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("supports assemblies, special names and unfamiliar nested fields without HTML injection", () => {
    context = setupViewer();
    const name = 'Дисплей / <img src=x onerror="alert(1)"> [1]';
    const root = {
      id: "/assembly",
      name: "Root",
      metadata: { original: { name: "Manufacturer assembly" } },
      parts: [
        {
          id: `/assembly/${name}`,
          name,
          metadata: {
            id: "source:1",
            original: { material: null, visible: false, count: 0 },
            properties: {
              arbitrary: {
                unknown: [false, 0, "<script>bad()</script>", null],
              },
            },
            extension: { "property/key": "untouched" },
          },
        },
      ],
    };
    context.display.setMetadataModel(root);
    context.display.onSelectionChanged(root.id);
    expect(panel().textContent).toContain("Manufacturer assembly");
    context.display.onSelectionChanged(root.parts[0].id);
    expandAll();
    expect(panel().textContent).toContain(name);
    expect(panel().textContent).toContain("false");
    expect(panel().textContent).toContain("null");
    expect(panel().textContent).toContain("<script>bad()</script>");
    expect(panel().textContent).toContain("property/key");
    expect(panel().textContent).toContain("untouched");
    expect(panel().querySelector("img,script")).toBeNull();
    expect(panel().textContent).not.toContain("Manufacturer assembly");
  });

  it("does not invent a material or stable ID for an unannotated component", () => {
    context = setupViewer();
    context.display.setMetadataModel({
      id: "/n",
      name: "Plain part",
      subtype: "solid",
    });
    context.display.showMetadata("/n");
    expandAll();
    expect(panel().textContent).toContain("ID метаданных не задан");
    expect(panel().textContent).toContain(
      "Метаданные STEP для этого компонента не переданы",
    );
    expect(panel().textContent).toContain("viewer_path");
    expect(panel().textContent).not.toContain("material");
    context.display.showMetadata("/missing");
    expect(panel().textContent).toContain("недоступны");
    expect(panel().textContent).not.toContain("Plain part");
  });

  it("shows typed vendor attributes immediately before technical identity and topology", () => {
    context = setupViewer();
    context.display.setMetadataModel({
      id: "/display",
      name: "Display",
      metadata: {
        schema_version: 1,
        id: "long-source-revision",
        topology: { faces: 3 },
        source: { filename: "display.step" },
        original: {
          name: "Waveshare",
          definition_label: "0:1:1:777",
          occurrence_path: ["0:1:1:778"],
        },
        properties: {
          named_data: {
            strings: { ProductID: "LCD-101", Description: "Display panel" },
            integers: { ProductID: 101 },
            reals: { Thickness: 3.5 },
          },
        },
        instance_properties: {
          named_data: { strings: { Description: "Mounted display" } },
        },
      },
    });
    context.display.showMetadata("/display");
    expect(panel().textContent).toContain("LCD-101");
    expect(panel().textContent).toContain("Display panel");
    expect(panel().textContent).toContain("Mounted display");
    expect(panel().textContent).toContain("3.5");
    const sections = [...panel().querySelectorAll(":scope > details")];
    const labels = sections.map(
      (section) => section.querySelector("summary").textContent,
    );
    expect(labels.slice(0, 2)).toEqual([
      "Свойства",
      "Свойства экземпляра · из STEP",
    ]);
    expect(panel().textContent).toContain("ProductID · strings");
    expect(panel().textContent).toContain("ProductID · integers");
    expect(panel().textContent).not.toContain("0:1:1:777");
    expect(
      sections.find(
        (section) =>
          section.querySelector("summary").textContent ===
          "Исходные свойства · из STEP",
      ).open,
    ).toBe(false);
    expect(
      panel().querySelector('[title="named_data.strings.ProductID"]'),
    ).not.toBeNull();
    // Vendor values have only their main Properties accordion as an ancestor.
    expect(sections[0].querySelectorAll("details")).toHaveLength(0);
    expect(labels.indexOf("source")).toBe(-1);
    expect(labels.indexOf("Источник")).toBeLessThan(
      labels.indexOf("schema_version"),
    );
    expect(
      sections.find(
        (section) =>
          section.querySelector("summary").textContent === "Источник",
      ).open,
    ).toBe(false);
    const vendor = [...panel().querySelectorAll("dd")].find(
      (cell) => cell.textContent === "LCD-101",
    );
    let ancestor = vendor.parentElement;
    while (ancestor !== panel()) {
      if (ancestor.tagName === "DETAILS") expect(ancestor.open).toBe(true);
      ancestor = ancestor.parentElement;
    }
  });

  it("copies a complete reference distinguishing identical source parts at different placements", async () => {
    context = setupViewer();
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    context.display.setMetadataModel({
      id: "/button 2",
      name: "Button",
      metadata: {
        id: "source/button",
        instance_id: "project/reset",
        identity_scope: "source_revision",
        source: { filename: "button.step", sha256: "abc" },
      },
    });
    context.display.showMetadata("/button 2");
    panel().querySelector("button").click();
    await Promise.resolve();
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({
      id: "source/button",
      instance_id: "project/reset",
      identity_scope: "source_revision",
      source: { filename: "button.step", sha256: "abc" },
      viewer_path: "/button 2",
    });
    expect(panel().textContent).toContain("Скопировано");
  });

  it("tree selection drives the inspector and clear/re-render drops stale metadata", async () => {
    context = setupViewer();
    const { viewer, renderOptions, viewerOptions } = context;
    const model = await loadExample("box1");
    model.metadata = { original: { name: "Source before reload" } };
    viewer.render(model, renderOptions, viewerOptions);
    const slash = model.id.lastIndexOf("/");
    viewer.handlePick(
      model.id.slice(0, slash),
      model.id.slice(slash + 1),
      false,
      false,
      false,
      null,
      "node",
      true,
    );
    expect(panel().textContent).toContain("Source before reload");
    expect(panel().textContent).toContain("Габариты · текущая сцена");
    const bounds = [...panel().querySelectorAll("details")].find(
      (item) =>
        item.querySelector("summary").textContent ===
        "Габариты · текущая сцена",
    );
    expect(bounds.open).toBe(false);
    bounds.open = true;
    bounds.dispatchEvent(new Event("toggle"));
    expect(panel().textContent).toContain("viewer world");
    viewer.clear();
    expect(panel().textContent).toContain("Выберите компонент");
    const next = await loadExample("box1");
    next.metadata = { original: { name: "Source after reload" } };
    viewer.render(next, renderOptions, viewerOptions);
    expect(panel().textContent).not.toContain("Source before reload");
    expect(panel().textContent).not.toContain("Source after reload");
    context.display.showMetadata(next.id);
    expect(panel().textContent).toContain("Source after reload");
  });

  it("keeps imported names harmless in the accompanying history", () => {
    const container = document.createElement("div");
    const info = new Info(container);
    info.bbInfo(
      "/<svg onload=alert(1)>",
      "<img src=x>",
      new Box3(new Vector3(), new Vector3(1, 1, 1)),
    );
    expect(container.querySelector("svg,img")).toBeNull();
    expect(container.textContent).toContain("<img src=x>");
  });

  it("synchronizes inspected component, tree highlight and bbox without moving the camera", async () => {
    context = setupViewer();
    const { viewer, renderOptions, viewerOptions } = context;
    const model = await loadExample("box1");
    viewer.render(model, renderOptions, viewerOptions);
    viewer.inspectComponent(model.id);
    const camera = viewer.rendered.camera.getPosition().toArray();
    let leaf = model;
    while (leaf.parts?.length) leaf = leaf.parts[0];
    viewer.inspectComponent(leaf.id);
    expect(viewer.lastBbox.id).toBe(leaf.id);
    expect(viewer.rendered.treeview.lastLabel.textContent).toContain(leaf.name);
    expect(panel().querySelector("h3").textContent).toBe(leaf.name);
    viewer.inspectComponent(leaf.id);
    expect(viewer.lastBbox.id).toBe(leaf.id);
    expect(
      viewer.rendered.treeview.lastLabel.classList.contains(
        "tv-node-label-highlight",
      ),
    ).toBe(true);
    expect(viewer.rendered.camera.getPosition().toArray()).toEqual(camera);
    viewer.inspectComponent(null);
    expect(viewer.lastBbox).toBeNull();
    expect(viewer.rendered.treeview.lastLabel).toBeNull();
    expect(
      context.container.querySelector(".tv-node-label-highlight"),
    ).toBeNull();
    expect(panel().textContent).toContain("Выберите компонент");
  });
});

describe("Component metadata canvas picking", () => {
  it("inspects a fresh pick on a plain click, ignoring drags and clearing blank clicks", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    const showMetadata = vi.fn();
    const inspectComponent = vi.fn();
    const host = {
      ready: true,
      renderer: { domElement: canvas },
      rendered: { nestedGroup: { groups: {} } },
      display: { showMetadata },
      cadTools: { enabledTool: null },
      inspectComponent,
      idPicker: {
        pickAt: vi.fn().mockReturnValue({
          info: { solidPath: "/assembly/Дисплей / 1", topo: "face" },
        }),
      },
    };
    const controller = new PickingController(host);
    const pointer = (type, x, y) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          button: 0,
          pointerId: 1,
          clientX: x,
          clientY: y,
        }),
      );
    pointer("pointerdown", 10, 10);
    pointer("pointerup", 10, 10);
    expect(inspectComponent).toHaveBeenLastCalledWith("/assembly/Дисплей / 1");
    pointer("pointerdown", 10, 10);
    pointer("pointerup", 20, 10);
    expect(inspectComponent).toHaveBeenCalledTimes(1);
    host.idPicker.pickAt.mockReturnValue(null);
    pointer("pointerdown", 10, 10);
    pointer("pointerup", 10, 10);
    expect(inspectComponent).toHaveBeenLastCalledWith(null);
    host.cadTools.enabledTool = "properties";
    pointer("pointerdown", 10, 10);
    pointer("pointerup", 10, 10);
    expect(inspectComponent).toHaveBeenCalledTimes(2);
    expect(showMetadata).toHaveBeenLastCalledWith(null);
    controller.dispose();
    pointer("pointerdown", 10, 10);
    pointer("pointerup", 10, 10);
    expect(inspectComponent).toHaveBeenCalledTimes(2);
    expect(showMetadata).toHaveBeenCalledTimes(1);
  });
});
