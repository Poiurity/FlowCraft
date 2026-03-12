import { AppStateSchema, type AppState } from '../models/appstate';

/**
 * In-memory AppState store. In production, replace with persistent storage.
 * Keyed by session ID.
 */
const sessions = new Map<string, AppState>();

export class AppStateManager {
  getState(sessionId: string): AppState | undefined {
    return sessions.get(sessionId);
  }

  setState(sessionId: string, state: AppState): AppState {
    const validated = AppStateSchema.parse(state);
    sessions.set(sessionId, validated);
    return validated;
  }

  deleteSession(sessionId: string): boolean {
    return sessions.delete(sessionId);
  }

  createDefaultState(): AppState {
    return AppStateSchema.parse({
      appName: 'My App',
      theme: { primaryColor: '#2196F3', brightness: 'light' },
      screens: [
        {
          id: 'home',
          name: 'HomeScreen',
          route: '/',
          appBar: { title: 'Home' },
          body: {
            type: 'center',
            props: {},
            children: [
              {
                type: 'text',
                props: { content: 'Welcome to FlowCraft!', style: { fontSize: 24, fontWeight: 'bold' } },
              },
            ],
          },
        },
      ],
      navigation: { type: 'stack', initialRoute: '/' },
    });
  }
}
