// Widget types are dynamic — registry can add new ones at runtime
export type WidgetType = string;

export interface WidgetNode {
  type: WidgetType;
  props: Record<string, any>;
  children?: WidgetNode[];
}

export interface Action {
  type: 'navigate' | 'pop' | 'none'
    | 'addItem' | 'removeItem' | 'toggleItemField'
    | 'increment' | 'decrement' | 'setValue' | 'clearField';
  target?: string;
  listName?: string;
  fieldName?: string;
  valueFrom?: string;
  clearFields?: string[];
  itemTemplate?: Record<string, any>;
}

export interface StateVariable {
  name: string;
  type: 'string' | 'int' | 'double' | 'bool' | 'stringList' | 'itemList';
  initialValue?: any;
  itemFields?: { name: string; type: 'string' | 'int' | 'double' | 'bool' }[];
}

export interface ScreenState {
  variables: StateVariable[];
}

export interface AppBarConfig {
  title: string;
  centerTitle?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
  elevation?: number;
  titleFontSize?: number;
  titleFontWeight?: string;
  actions?: { icon: string; action?: Action }[];
  leading?: { icon: string; action?: Action };
}

export interface FabConfig {
  icon: string;
  label?: string;
  action?: Action;
  backgroundColor?: string;
}

export interface Screen {
  id: string;
  name: string;
  route: string;
  appBar?: AppBarConfig;
  body: WidgetNode;
  fab?: FabConfig;
  backgroundColor?: string;
  screenState?: ScreenState;
}

export interface ThemeConfig {
  primaryColor: string;
  accentColor?: string;
  scaffoldBackgroundColor?: string;
  fontFamily?: string;
  brightness: 'light' | 'dark';
  defaultFontSize?: number;
  defaultBorderRadius?: number;
  appBarTheme?: { backgroundColor?: string; foregroundColor?: string; elevation?: number; centerTitle?: boolean; titleFontSize?: number; titleFontWeight?: string };
  cardTheme?: { elevation?: number; color?: string; shadowColor?: string; borderRadius?: number };
  elevatedButtonTheme?: { borderRadius?: number; elevation?: number; backgroundColor?: string; foregroundColor?: string; padding?: { horizontal?: number; vertical?: number } };
  inputTheme?: { fillColor?: string; filled?: boolean; borderRadius?: number; borderColor?: string; focusedBorderColor?: string; labelFontSize?: number };
  textTheme?: { headlineFontSize?: number; bodyFontSize?: number; labelFontSize?: number; headlineColor?: string; bodyColor?: string };
}

export interface NavigationConfig {
  type: 'stack' | 'bottomNav' | 'tabs';
  initialRoute: string;
  bottomNavItems?: { icon: string; label: string; screenId: string }[];
}

export interface AppState {
  appName: string;
  theme: ThemeConfig;
  screens: Screen[];
  navigation: NavigationConfig;
}
