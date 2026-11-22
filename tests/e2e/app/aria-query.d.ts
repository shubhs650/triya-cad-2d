// The part of aria-query (Apache-2.0, M7-10) the accessibility check reads; the package ships
// no types and @types/aria-query would be one more dependency for four fields.
declare module 'aria-query' {
  interface RoleDefinition {
    readonly abstract: boolean;
    readonly props: Readonly<Record<string, unknown>>;
    readonly requiredProps: Readonly<Record<string, unknown>>;
    readonly requiredOwnedElements: readonly (readonly string[])[];
    readonly requiredContextRole: readonly string[];
  }
  interface AttributeDefinition {
    readonly type: string;
    readonly values?: readonly unknown[];
  }
  export const roles: { entries(): Iterable<[string, RoleDefinition]> };
  export const aria: { entries(): Iterable<[string, AttributeDefinition]> };
}
