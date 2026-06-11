// Single source of truth for which widget props carry data bindings.
//
// Imported by BOTH the code generator (which interpolates {{...}} bindings) and
// the static validator (which checks them). Keeping the bindable-prop set in one
// place is what prevents the two layers from drifting — the exact class of bug
// where the validator checked `props.text`/`props.label` while the generator
// rendered from `props.content`, so undeclared bindings shipped uncompilable.

export interface BindingPropSpec {
  /** Prop keys whose string value may contain {{var}} / {{item.field}} bindings. */
  textBindingProps: readonly string[];
  /** Prop keys whose string value is a direct state-variable reference. */
  varRefProps: readonly string[];
}

/**
 * The prop key `wText` actually interpolates bindings from. The code generator
 * imports this so the render site and the validated site are symbol-equal; the
 * lockstep test asserts it appears in the manifest below.
 */
export const TEXT_CONTENT_PROP = 'content';

// Legacy keys the validator has always checked on every node. Kept so the change
// is a strict superset of prior behavior (no regression) while adding `content`.
const LEGACY_TEXT_PROPS = ['text', 'label'] as const;
const LEGACY_VARREF_PROPS = ['boundTo'] as const;

export const BINDING_PROPS: Record<string, BindingPropSpec> = {
  text: {
    textBindingProps: [TEXT_CONTENT_PROP, ...LEGACY_TEXT_PROPS],
    varRefProps: LEGACY_VARREF_PROPS,
  },
  textField: {
    textBindingProps: ['hint', ...LEGACY_TEXT_PROPS],
    varRefProps: LEGACY_VARREF_PROPS,
  },
};

/** Fallback for node types not explicitly listed (registry widgets, layout, …). */
export const DEFAULT_BINDING_PROPS: BindingPropSpec = {
  textBindingProps: LEGACY_TEXT_PROPS,
  varRefProps: LEGACY_VARREF_PROPS,
};

export function bindingPropsFor(nodeType: string): BindingPropSpec {
  return BINDING_PROPS[nodeType] ?? DEFAULT_BINDING_PROPS;
}

// ── Bind-type knowledge (C15) ────────────────────────────────────────────────
// Shared so the validator (which rejects type-mismatched bindings) and codegen
// (which guards what it emits) agree on which state-var types each site accepts.

export type StateVarType = 'string' | 'int' | 'double' | 'bool' | 'stringList' | 'itemList';

/**
 * State-var types a hardcoded widget's `boundTo` accepts. Codegen lowers:
 *  - checkbox/switch → `value: _v` expecting bool
 *  - textField       → controller + onChanged with string / int.tryParse / double.tryParse
 * Registry widgets (e.g. slider) declare their own type via def.stateBinding.stateType.
 */
export const HARDCODED_BIND_TYPES: Record<string, StateVarType[]> = {
  checkbox: ['bool'],
  switch: ['bool'],
  textField: ['string', 'int', 'double'],
  dropdown: ['string'],
  radioGroup: ['string'],
};

/** Only int/double can be the target of increment/decrement (codegen emits `_x++`). */
export function isIncrementable(varType: string): boolean {
  return varType === 'int' || varType === 'double';
}

/** addItem.clearFields resets `_f = ''` + `_fController.clear()` — string vars only. */
export function isClearable(varType: string): boolean {
  return varType === 'string';
}
