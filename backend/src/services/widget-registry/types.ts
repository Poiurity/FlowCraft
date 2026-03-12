export interface PropDefinition {
  name: string;
  dartParam: string;
  type: 'number' | 'string' | 'bool' | 'color' | 'icon' | 'edgeInsets';
  optional: boolean;
  defaultValue?: any;
}

export interface StateBindingDefinition {
  valueProp: string;
  onChangedProp: string;
  stateType: string;
}

export interface WidgetDefinition {
  name: string;
  dartWidget: string;
  category: 'input' | 'display' | 'layout';
  props: PropDefinition[];
  stateBinding?: StateBindingDefinition;
}
