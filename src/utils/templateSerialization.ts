import { LabelTemplate, LabelElement } from "../types";

/**
 * Generate a cryptographically strong unique ID with timestamp + entropy fallback
 */
export function generateUniqueId(prefix = "tmpl_"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}${crypto.randomUUID()}`;
  }
  return `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Deep clone any JS object/array to break all shared in-memory references
 */
export function deepClone<T>(obj: T): T {
  if (obj === undefined || obj === null) return obj;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(obj);
    } catch {
      // Fallback if structuredClone fails on non-serializable properties
    }
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Regenerate unique internal IDs for all child canvas elements,
 * updating any parentId links so parent-child relationships remain intact.
 */
export function regenerateChildElementIds(elements: LabelElement[]): LabelElement[] {
  if (!Array.isArray(elements)) return [];

  const cloned = deepClone(elements);
  const idMap = new Map<string, string>();

  // 1. Assign fresh unique ID to every element
  cloned.forEach((el) => {
    const oldId = el.id;
    const newId = generateUniqueId("el_");
    if (oldId) {
      idMap.set(oldId, newId);
    }
    el.id = newId;
  });

  // 2. Re-link parentId if element was linked to a parent
  cloned.forEach((el) => {
    if (el.parentId && idMap.has(el.parentId)) {
      el.parentId = idMap.get(el.parentId);
    }
  });

  return cloned;
}

export interface PrepareTemplateOptions {
  forceNewDocumentId?: boolean;
  forceNewElementIds?: boolean;
  isImport?: boolean;
  isSaveAs?: boolean;
  customName?: string;
}

/**
 * Prepare, validate, and encapsulate a template object for state mounting or file serialization.
 * Ensures complete encapsulation of metadata, page setup, element tree, and unique IDs.
 */
export function prepareTemplateForLoadOrImport(
  rawTemplate: Partial<LabelTemplate>,
  options: PrepareTemplateOptions = {}
): LabelTemplate {
  const cloned = deepClone(rawTemplate);

  // 1. Determine unique document ID
  let docId = cloned.id;
  if (options.forceNewDocumentId || options.isImport || options.isSaveAs || !docId) {
    docId = generateUniqueId("tmpl_");
  }

  // 2. Regenerate element IDs if requested or on import/Save As
  let elements = cloned.elements || [];
  if (options.forceNewElementIds || options.isImport || options.isSaveAs) {
    elements = regenerateChildElementIds(elements);
  } else {
    // Ensure every element has at least a valid id
    elements = elements.map((el: any) => ({
      ...el,
      id: el.id || generateUniqueId("el_"),
    }));
  }

  // 3. Encapsulate complete page setup, dimensions, orientation, and metadata
  const fullTemplate: LabelTemplate = {
    id: docId,
    name: options.customName || cloned.name || "Untitled Template",
    widthMm: typeof cloned.widthMm === "number" ? cloned.widthMm : 50,
    heightMm: typeof cloned.heightMm === "number" ? cloned.heightMm : 30,
    marginMm: typeof cloned.marginMm === "number" ? cloned.marginMm : 0,
    uniqueField: cloned.uniqueField || "AccessionNo",
    elements,
    lastModified: new Date().toISOString(),

    // Page setup & geometry parameters
    shape: cloned.shape || "rectangle",
    orientation: cloned.orientation || "portrait",
    unit: cloned.unit || "mm",
    dpi: cloned.dpi || 300,
    mediaType: cloned.mediaType || "continuous",
    rows: typeof cloned.rows === "number" ? cloned.rows : 1,
    columns: typeof cloned.columns === "number" ? cloned.columns : 1,
    pageWidthMm: typeof cloned.pageWidthMm === "number" ? cloned.pageWidthMm : cloned.widthMm || 50,
    pageHeightMm: typeof cloned.pageHeightMm === "number" ? cloned.pageHeightMm : cloned.heightMm || 30,

    // Margins and paddings
    marginTop: typeof cloned.marginTop === "number" ? cloned.marginTop : 0,
    marginBottom: typeof cloned.marginBottom === "number" ? cloned.marginBottom : 0,
    marginLeft: typeof cloned.marginLeft === "number" ? cloned.marginLeft : 0,
    marginRight: typeof cloned.marginRight === "number" ? cloned.marginRight : 0,
    paddingLeftMm: typeof cloned.paddingLeftMm === "number" ? cloned.paddingLeftMm : 0,
    paddingRightMm: typeof cloned.paddingRightMm === "number" ? cloned.paddingRightMm : 0,
    paddingTopMm: typeof cloned.paddingTopMm === "number" ? cloned.paddingTopMm : 0,
    paddingBottomMm: typeof cloned.paddingBottomMm === "number" ? cloned.paddingBottomMm : 0,

    // Gaps and layout direction
    gapHorizontal: typeof cloned.gapHorizontal === "number" ? cloned.gapHorizontal : 0,
    gapVertical: typeof cloned.gapVertical === "number" ? cloned.gapVertical : 0,
    setGapManually: cloned.setGapManually ?? false,
    setLabelSizeManually: cloned.setLabelSizeManually ?? false,
    startingCorner: cloned.startingCorner || "top-left",
    primaryDirection: cloned.primaryDirection || "horizontal",
    cornerRadiusMm: typeof cloned.cornerRadiusMm === "number" ? cloned.cornerRadiusMm : 0,

    // Effects
    mirrorImage: cloned.mirrorImage ?? false,
    negative: cloned.negative ?? false,
  };

  return fullTemplate;
}

/**
 * Serialize a template to a self-contained JSON string payload for saving to file.
 * Handles "Save" and "Save As" actions with guaranteed structural isolation.
 */
export function serializeTemplateToFile(
  template: LabelTemplate,
  options: { isSaveAs?: boolean; customName?: string } = {}
): { serializedJson: string; templateToSave: LabelTemplate } {
  const templateToSave = prepareTemplateForLoadOrImport(template, {
    forceNewDocumentId: options.isSaveAs,
    forceNewElementIds: options.isSaveAs,
    isSaveAs: options.isSaveAs,
    customName: options.customName,
  });

  templateToSave.lastModified = new Date().toISOString();

  const payload = {
    __bcs_version: "3.7.1",
    __bcs_type: "template",
    ...templateToSave,
  };

  return {
    serializedJson: JSON.stringify(payload, null, 2),
    templateToSave,
  };
}

/**
 * Deserialize a template payload read from disk (.bcs / .json file).
 * Deep clones and regenerates element/document IDs to prevent caching collisions.
 */
export function deserializeTemplateFromFile(
  fileContent: string | object,
  options: { forceNewDocumentId?: boolean; isImport?: boolean; forceNewElementIds?: boolean } = {}
): LabelTemplate {
  let parsed: any;
  if (typeof fileContent === "string") {
    parsed = JSON.parse(fileContent);
  } else {
    parsed = fileContent;
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid template file schema");
  }

  return prepareTemplateForLoadOrImport(parsed, {
    forceNewDocumentId: options.forceNewDocumentId || options.isImport,
    forceNewElementIds: options.forceNewElementIds !== undefined ? options.forceNewElementIds : true, // Always re-key element IDs on file open/import to guarantee unique DOM keys
    isImport: options.isImport,
  });
}

/**
 * Create a new blank template with a guaranteed unique document ID and clean defaults.
 */
export function createNewBlankTemplate(
  name = "Untitled Template",
  overrides: Partial<LabelTemplate> = {}
): LabelTemplate {
  return prepareTemplateForLoadOrImport(
    {
      name,
      widthMm: 50,
      heightMm: 30,
      marginMm: 0,
      uniqueField: "AccessionNo",
      elements: [],
      shape: "rectangle",
      orientation: "portrait",
      unit: "mm",
      mediaType: "continuous",
      dpi: 300,
      rows: 1,
      columns: 1,
      ...overrides,
    },
    {
      forceNewDocumentId: true,
      forceNewElementIds: true,
    }
  );
}
