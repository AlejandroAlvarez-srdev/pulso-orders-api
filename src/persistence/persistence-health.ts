export const PERSISTENCE_HEALTH = Symbol('PERSISTENCE_HEALTH');

export interface PersistenceHealth {
  readonly driver: string;
  isHealthy(): Promise<boolean>;
}
