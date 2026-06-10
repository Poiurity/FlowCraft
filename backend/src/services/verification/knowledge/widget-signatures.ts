// §C.3 — Constructor signatures for registry-rendered widgets.
// Keyed by dartWidget (matches WidgetDefinition.dartWidget, NOT node.type).
// strict:true → unknown prop is an N2 error; strict:false → warning.

type DartType = 'double' | 'int' | 'String' | 'bool' | 'Color' | 'IconData' | 'Widget' | 'VoidCallback' | 'ValueChanged';

interface CtorParam {
  dartParam: string;
  positional: boolean;
  required: boolean;
  dartType: DartType;
}

export interface CtorSig {
  params: Record<string, CtorParam>;
  strict: boolean;
}

const p = (
  dartParam: string,
  dartType: DartType,
  required = false,
  positional = false,
): CtorParam => ({ dartParam, dartType, required, positional });

export const WIDGET_SIGNATURES: Record<string, CtorSig> = {
  'Image.network': {
    strict: false,
    params: {
      src:    p('',        'String',   true, true),
      width:  p('width',   'double'),
      height: p('height',  'double'),
      fit:    p('fit',     'String'),
    },
  },
  'Icon': {
    strict: false,
    params: {
      name:  p('',       'IconData', true, true),
      size:  p('size',   'double'),
      color: p('color',  'Color'),
    },
  },
  'Divider': {
    strict: false,
    params: {
      height:    p('height',    'double'),
      thickness: p('thickness', 'double'),
      color:     p('color',     'Color'),
    },
  },
  'CircularProgressIndicator': {
    strict: false,
    params: {
      color: p('color', 'Color'),
    },
  },
  'LinearProgressIndicator': {
    strict: false,
    params: {
      value:           p('value',           'double'),
      color:           p('color',           'Color'),
      backgroundColor: p('backgroundColor', 'Color'),
    },
  },
  'Spacer': {
    strict: false,
    params: {
      flex: p('flex', 'int'),
    },
  },
  'Slider': {
    strict: false,
    params: {
      value:         p('value',         'double',       true),
      onChanged:     p('onChanged',     'ValueChanged', true),
      min:           p('min',           'double'),
      max:           p('max',           'double'),
      divisions:     p('divisions',     'int'),
      activeColor:   p('activeColor',   'Color'),
      inactiveColor: p('inactiveColor', 'Color'),
    },
  },
  // DatePicker is intentionally absent — the datePicker registry.json entry is a C11 poison.
};
