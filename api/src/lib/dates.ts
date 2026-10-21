export const today = () => new Date().toISOString().slice(0, 10);
/** The later of two YYYY-MM-DD dates; either may be missing. */
export const latest = (a: string | null | undefined, b: string) => (a && a > b ? a : b);
