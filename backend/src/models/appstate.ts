import { z } from 'zod';

// ── Style schemas ──

export const TextStyleSchema = z.object({
  fontSize: z.number().optional(),
  fontWeight: z.enum(['normal', 'bold', 'w100', 'w200', 'w300', 'w400', 'w500', 'w600', 'w700', 'w800', 'w900']).optional(),
  color: z.string().optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  letterSpacing: z.number().optional(),
  decoration: z.enum(['none', 'underline', 'lineThrough', 'overline']).optional(),
});

export const EdgeInsetsSchema = z.object({
  top: z.number().optional(),
  bottom: z.number().optional(),
  left: z.number().optional(),
  right: z.number().optional(),
  all: z.number().optional(),
  horizontal: z.number().optional(),
  vertical: z.number().optional(),
});

export const BoxShadowSchema = z.object({
  color: z.string().optional(),
  blurRadius: z.number().optional(),
  spreadRadius: z.number().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

export const BoxDecorationSchema = z.object({
  color: z.string().optional(),
  borderRadius: z.number().optional(),
  border: z.object({
    color: z.string().optional(),
    width: z.number().optional(),
  }).optional(),
  boxShadow: BoxShadowSchema.optional(),
  gradient: z.object({
    type: z.enum(['linear', 'radial']).optional(),
    colors: z.array(z.string()),
    begin: z.string().optional(),
    end: z.string().optional(),
  }).optional(),
});

// ── State variable (for stateful screens) ──

export const StateVariableSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'int', 'double', 'bool', 'stringList', 'itemList']),
  initialValue: z.any().optional(),
  itemFields: z.array(z.object({
    name: z.string(),
    type: z.enum(['string', 'int', 'double', 'bool']),
  })).optional(),
});

// ── Action schema (extended) ──

export const ActionSchema = z.object({
  type: z.enum([
    'navigate', 'pop', 'none',
    'addItem', 'removeItem', 'toggleItemField',
    'increment', 'decrement', 'setValue', 'clearField',
  ]),
  target: z.string().optional(),
  listName: z.string().optional(),
  fieldName: z.string().optional(),
  valueFrom: z.string().optional(),
  clearFields: z.array(z.string()).optional(),
  itemTemplate: z.record(z.string(), z.any()).optional(),
});

// ── Widget node (recursive) ──

// Widget types are dynamic (registry can add new ones), so we use z.string()
export const WidgetTypeEnum = z.string();

export type WidgetNode = {
  type: z.infer<typeof WidgetTypeEnum>;
  props: Record<string, any>;
  children?: WidgetNode[];
};

export const WidgetNodeSchema: z.ZodType<WidgetNode> = z.lazy(() =>
  z.object({
    type: WidgetTypeEnum,
    props: z.record(z.string(), z.any()).default({}),
    children: z.array(WidgetNodeSchema).optional(),
  })
) as z.ZodType<WidgetNode>;

// ── AppBar ──

export const AppBarActionSchema = z.object({
  icon: z.string(),
  action: ActionSchema.optional(),
});

export const AppBarSchema = z.object({
  title: z.string(),
  centerTitle: z.boolean().optional(),
  backgroundColor: z.string().optional(),
  foregroundColor: z.string().optional(),
  elevation: z.number().optional(),
  titleFontSize: z.number().optional(),
  titleFontWeight: z.string().optional(),
  actions: z.array(AppBarActionSchema).optional(),
  leading: z.object({ icon: z.string(), action: ActionSchema.optional() }).optional(),
});

// ── FloatingActionButton ──

export const FabSchema = z.object({
  icon: z.string().default('add'),
  label: z.string().optional(),
  action: ActionSchema.optional(),
  backgroundColor: z.string().optional(),
});

// ── Screen state ──

export const ScreenStateSchema = z.object({
  variables: z.array(StateVariableSchema),
});

// ── Screen ──

export const ScreenSchema = z.object({
  id: z.string(),
  name: z.string(),
  route: z.string(),
  appBar: AppBarSchema.optional(),
  body: WidgetNodeSchema,
  fab: FabSchema.optional(),
  backgroundColor: z.string().optional(),
  screenState: ScreenStateSchema.optional(),
});

// ── Theme ──

export const AppBarThemeSchema = z.object({
  backgroundColor: z.string().optional(),
  foregroundColor: z.string().optional(),
  elevation: z.number().optional(),
  centerTitle: z.boolean().optional(),
  titleFontSize: z.number().optional(),
  titleFontWeight: z.string().optional(),
}).optional();

export const CardThemeSchema = z.object({
  elevation: z.number().optional(),
  color: z.string().optional(),
  shadowColor: z.string().optional(),
  borderRadius: z.number().optional(),
}).optional();

export const ButtonThemeSchema = z.object({
  borderRadius: z.number().optional(),
  elevation: z.number().optional(),
  backgroundColor: z.string().optional(),
  foregroundColor: z.string().optional(),
  fontSize: z.number().optional(),
  minimumSize: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
  }).optional(),
  padding: z.object({
    horizontal: z.number().optional(),
    vertical: z.number().optional(),
  }).optional(),
}).optional();

export const InputThemeSchema = z.object({
  fillColor: z.string().optional(),
  filled: z.boolean().optional(),
  borderRadius: z.number().optional(),
  borderColor: z.string().optional(),
  focusedBorderColor: z.string().optional(),
  labelFontSize: z.number().optional(),
}).optional();

export const TextThemeSchema = z.object({
  headlineFontSize: z.number().optional(),
  bodyFontSize: z.number().optional(),
  labelFontSize: z.number().optional(),
  headlineColor: z.string().optional(),
  bodyColor: z.string().optional(),
}).optional();

export const ThemeSchema = z.object({
  primaryColor: z.string().default('#2196F3'),
  accentColor: z.string().optional(),
  scaffoldBackgroundColor: z.string().optional(),
  fontFamily: z.string().optional(),
  brightness: z.enum(['light', 'dark']).default('light'),
  appBarTheme: AppBarThemeSchema,
  cardTheme: CardThemeSchema,
  elevatedButtonTheme: ButtonThemeSchema,
  inputTheme: InputThemeSchema,
  textTheme: TextThemeSchema,
  defaultFontSize: z.number().optional(),
  defaultBorderRadius: z.number().optional(),
});

// ── Navigation ──

export const NavigationSchema = z.object({
  type: z.enum(['stack', 'bottomNav', 'tabs']).default('stack'),
  initialRoute: z.string().default('/'),
  bottomNavItems: z.array(z.object({
    icon: z.string(),
    label: z.string(),
    screenId: z.string(),
  })).optional(),
});

// ── Root AppState ──

export const AppStateSchema = z.object({
  appName: z.string().default('FlowCraft App'),
  theme: ThemeSchema.default({}),
  screens: z.array(ScreenSchema).min(1),
  navigation: NavigationSchema.default({}),
});

export type AppState = z.infer<typeof AppStateSchema>;
export type Screen = z.infer<typeof ScreenSchema>;
export type ScreenState = z.infer<typeof ScreenStateSchema>;
export type StateVariable = z.infer<typeof StateVariableSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Navigation = z.infer<typeof NavigationSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type EdgeInsets = z.infer<typeof EdgeInsetsSchema>;
export type Action = z.infer<typeof ActionSchema>;
