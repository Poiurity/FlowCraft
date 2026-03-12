/**
 * Static JSON Schema for the AppState model (v2 with state management).
 * Uses $defs/$ref to handle recursive WidgetNode.
 */

const ACTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    type: {
      type: 'string' as const,
      enum: ['navigate', 'pop', 'none', 'addItem', 'removeItem', 'toggleItemField', 'increment', 'decrement', 'setValue', 'clearField'],
    },
    target: { type: 'string' as const },
    listName: { type: 'string' as const },
    fieldName: { type: 'string' as const },
    valueFrom: { type: 'string' as const },
    clearFields: { type: 'array' as const, items: { type: 'string' as const } },
    itemTemplate: { type: 'object' as const, additionalProperties: true },
  },
  required: ['type'] as const,
};

const STATE_VARIABLE_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const },
    type: { type: 'string' as const, enum: ['string', 'int', 'double', 'bool', 'stringList', 'itemList'] },
    initialValue: {},
    itemFields: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          type: { type: 'string' as const, enum: ['string', 'int', 'double', 'bool'] },
        },
        required: ['name', 'type'] as const,
      },
    },
  },
  required: ['name', 'type'] as const,
};

export function getAppStateJsonSchema(): Record<string, any> {
  return {
    type: 'object',
    properties: {
      appName: { type: 'string' },
      theme: {
        type: 'object',
        properties: {
          primaryColor: { type: 'string' },
          accentColor: { type: 'string' },
          scaffoldBackgroundColor: { type: 'string' },
          fontFamily: { type: 'string' },
          brightness: { type: 'string', enum: ['light', 'dark'] },
          defaultFontSize: { type: 'number' },
          defaultBorderRadius: { type: 'number' },
          appBarTheme: {
            type: 'object',
            properties: {
              backgroundColor: { type: 'string' },
              foregroundColor: { type: 'string' },
              elevation: { type: 'number' },
              centerTitle: { type: 'boolean' },
              titleFontSize: { type: 'number' },
              titleFontWeight: { type: 'string' },
            },
          },
          cardTheme: {
            type: 'object',
            properties: {
              elevation: { type: 'number' },
              color: { type: 'string' },
              shadowColor: { type: 'string' },
              borderRadius: { type: 'number' },
            },
          },
          elevatedButtonTheme: {
            type: 'object',
            properties: {
              borderRadius: { type: 'number' },
              elevation: { type: 'number' },
              backgroundColor: { type: 'string' },
              foregroundColor: { type: 'string' },
              padding: {
                type: 'object',
                properties: {
                  horizontal: { type: 'number' },
                  vertical: { type: 'number' },
                },
              },
            },
          },
          inputTheme: {
            type: 'object',
            properties: {
              fillColor: { type: 'string' },
              filled: { type: 'boolean' },
              borderRadius: { type: 'number' },
              borderColor: { type: 'string' },
              focusedBorderColor: { type: 'string' },
              labelFontSize: { type: 'number' },
            },
          },
          textTheme: {
            type: 'object',
            properties: {
              headlineFontSize: { type: 'number' },
              bodyFontSize: { type: 'number' },
              labelFontSize: { type: 'number' },
              headlineColor: { type: 'string' },
              bodyColor: { type: 'string' },
            },
          },
        },
      },
      screens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            route: { type: 'string' },
            appBar: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                centerTitle: { type: 'boolean' },
                backgroundColor: { type: 'string' },
                foregroundColor: { type: 'string' },
                elevation: { type: 'number' },
                titleFontSize: { type: 'number' },
                titleFontWeight: { type: 'string' },
                actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { icon: { type: 'string' }, action: ACTION_SCHEMA },
                    required: ['icon'],
                  },
                },
              },
              required: ['title'],
            },
            body: { $ref: '#/$defs/WidgetNode' },
            fab: {
              type: 'object',
              properties: {
                icon: { type: 'string' },
                label: { type: 'string' },
                action: ACTION_SCHEMA,
                backgroundColor: { type: 'string' },
              },
            },
            backgroundColor: { type: 'string' },
            screenState: {
              type: 'object',
              properties: {
                variables: { type: 'array', items: STATE_VARIABLE_SCHEMA },
              },
              required: ['variables'],
            },
          },
          required: ['id', 'name', 'route', 'body'],
        },
      },
      navigation: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['stack', 'bottomNav', 'tabs'] },
          initialRoute: { type: 'string' },
          bottomNavItems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                icon: { type: 'string' },
                label: { type: 'string' },
                screenId: { type: 'string' },
              },
              required: ['icon', 'label', 'screenId'],
            },
          },
        },
      },
    },
    required: ['screens'],
    $defs: {
      WidgetNode: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'text', 'button', 'image', 'icon',
              'column', 'row', 'container', 'padding', 'sizedBox', 'card',
              'listView', 'textField', 'center', 'expanded', 'spacer',
              'divider', 'circularProgressIndicator', 'checkbox', 'listTile', 'switch',
            ],
          },
          props: { type: 'object', additionalProperties: true },
          children: { type: 'array', items: { $ref: '#/$defs/WidgetNode' } },
        },
        required: ['type'],
      },
    },
  };
}
