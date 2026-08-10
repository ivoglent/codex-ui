/**
 * A model picker key must be safe to use as a native HTML option value.
 * JSON keeps model/provider boundaries unambiguous without control characters.
 */
export function modelPairKey(model: string, modelProvider: string): string {
  return JSON.stringify([modelProvider, model]);
}
