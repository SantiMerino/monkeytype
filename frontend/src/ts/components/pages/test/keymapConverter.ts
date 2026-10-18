import { KeymapStyle } from "@monkeytype/schemas/configs";
import { KeyLegends, LayoutObject } from "@monkeytype/schemas/layouts";

import {
  Finger,
  KeyboardDefinition,
  KeyDefinition,
  KeymapLayout,
  keymapLayouts,
} from "./keymapLayouts";

type ConvertOptions = {
  keymapStyle: KeymapStyle;
  showAllKeys: boolean;
  fingerZones?: boolean;
};

export function convertLayoutToKeymap(
  layout: LayoutObject,
  options: ConvertOptions,
): KeyboardDefinition {
  const keymapLayout = keymapLayouts[options.keymapStyle]?.[layout.type];

  if (keymapLayout === undefined) {
    throw new Error(
      `not supported style ${options.keymapStyle} and layout type ${layout.type}`,
    );
  }

  return convert({
    legends: layout.keys,
    layoutType: layout.type,
    keymap: keymapLayout,
    convertOptions: options,
  });
}

// standard touch typing finger per physical column, left to right
const columnFingers: Finger[] = [
  "leftPinky",
  "leftRing",
  "leftMiddle",
  "leftIndex",
  "leftIndex",
  "rightIndex",
  "rightIndex",
  "rightMiddle",
  "rightRing",
  "rightPinky",
];

export function getFinger(options: {
  row: keyof LayoutObject["keys"];
  col: number;
  layoutType: LayoutObject["type"];
  keymapStyle: KeymapStyle;
  rotation?: number;
}): Finger {
  const { row, col, layoutType, keymapStyle, rotation } = options;
  if (row === "row5") return "thumb";

  const isMatrix = keymapStyle === "matrix" || keymapStyle === "split_matrix";

  // number row and the iso extra key (left of z) shift columns by one
  let column = col;
  if (row === "row1" || (row === "row4" && layoutType === "iso" && !isMatrix)) {
    column = col - 1;
  }

  let finger =
    columnFingers[Math.min(Math.max(column, 0), columnFingers.length - 1)] ??
    "rightPinky";

  // alice duplicates the center key on both halves, the right half is rotated negative
  if (
    keymapStyle === "alice" &&
    rotation !== undefined &&
    rotation < 0 &&
    finger === "leftIndex"
  ) {
    finger = "rightIndex";
  }

  return finger;
}

function convert(options: {
  legends: LayoutObject["keys"];
  layoutType: LayoutObject["type"];
  keymap: KeymapLayout;
  convertOptions: ConvertOptions;
}): KeyboardDefinition {
  const isShowAllKeys = options.convertOptions.showAllKeys ?? false;

  return options.keymap.map((keys) =>
    keys
      .map((keyDef) => {
        const layoutLegend =
          keyDef.layoutPosition?.row &&
          options.legends[keyDef.layoutPosition.row]?.[
            keyDef.layoutPosition.col
          ];

        const legends = keyDef.isLayoutIndicator
          ? buildLegends(" ")
          : buildLegends(keyDef.legend ?? layoutLegend);

        if (keyDef.isExtraKey && !isShowAllKeys) {
          return undefined;
        }

        const final = {
          ...keyDef,
          ...(isShowAllKeys ? keyDef.extraKeysOverride : {}),
        };

        const layerPosition = keyDef.layerPosition;
        const layerLegend =
          layerPosition &&
          options.legends[layerPosition.row]?.[layerPosition.col];
        const layerLegends =
          layerPosition && layerLegend !== undefined
            ? { layer: layerPosition.layer, legends: buildLegends(layerLegend) }
            : undefined;

        let finger: Finger | undefined;
        if (options.convertOptions.fingerZones !== true) {
          finger = undefined;
        } else if (keyDef.finger !== undefined) {
          finger = keyDef.finger;
        } else if (final.isLayoutIndicator === true || keyDef.legend === " ") {
          finger = "thumb";
        } else if (keyDef.layoutPosition?.row !== undefined) {
          finger = getFinger({
            row: keyDef.layoutPosition.row,
            col: keyDef.layoutPosition.col,
            layoutType: options.layoutType,
            keymapStyle: options.convertOptions.keymapStyle,
            rotation: final.rotation,
          });
        }

        return {
          legends,
          ...(final.height !== undefined ? { height: final.height } : {}),
          ...(final.width !== undefined ? { width: final.width } : {}),
          ...(final.x !== undefined ? { x: final.x } : {}),
          ...(final.y !== undefined ? { y: final.y } : {}),
          ...(final.rotation !== undefined ? { rotation: final.rotation } : {}),
          ...(final.isLayoutIndicator === true
            ? { isLayoutIndicator: true }
            : {}),
          ...(final.isHoming === true ? { isHoming: true } : {}),
          ...(final.align !== undefined ? { align: final.align } : {}),
          ...(finger !== undefined ? { finger } : {}),
          ...(layerLegends !== undefined ? { layerLegends } : {}),
          ...(keyDef.activatesLayer !== undefined
            ? { activatesLayer: keyDef.activatesLayer }
            : {}),
          ...(keyDef.isShift === true ? { isShift: true } : {}),
        } satisfies KeyDefinition;
      })
      //filter skipped keys
      .filter((it) => it !== undefined),
  );
}

const emptyLegends = ["", "", "", ""];
function buildLegends(legends: string | KeyLegends | undefined): KeyLegends {
  if (legends === undefined) return emptyLegends;
  if (typeof legends === "string") {
    return new Array<string>(4).fill(legends);
  }

  switch (legends.length) {
    case 1:
      return [legends[0] as string, legends[0] as string, "", ""];
    case 2:
      return [...legends, "", ""];
    case 3:
      return [...legends, ""];
    default:
      return legends;
  }
}

export type KeyCombo = { layer?: number; shift: boolean };

// which layer and modifiers are needed to type a character on this keyboard
export function findKeyCombo(
  keyboard: KeyboardDefinition,
  character: string | undefined,
): KeyCombo | undefined {
  if (character === undefined) return undefined;
  const keys = keyboard.flat();

  if (keys.some((key) => key.legends[0] === character)) {
    return { shift: false };
  }
  if (keys.some((key) => key.legends[1] === character)) {
    return { shift: true };
  }
  for (const key of keys) {
    const layerLegends = key.layerLegends;
    if (layerLegends === undefined) continue;
    if (layerLegends.legends[0] === character) {
      return { layer: layerLegends.layer, shift: false };
    }
    if (layerLegends.legends[1] === character) {
      return { layer: layerLegends.layer, shift: true };
    }
  }
  return undefined;
}

// whether a key has to be pressed (or held) to type the character
export function isKeyInCombo(
  key: KeyDefinition,
  character: string | undefined,
  combo: KeyCombo | undefined,
): boolean {
  if (character === undefined || combo === undefined) return false;

  if (combo.layer === undefined) {
    if (key.legends.some((legend) => legend === character)) return true;
  } else {
    if (key.activatesLayer === combo.layer) return true;
    if (
      key.layerLegends?.layer === combo.layer &&
      key.layerLegends.legends.includes(character)
    ) {
      return true;
    }
  }

  return combo.shift && key.isShift === true;
}
