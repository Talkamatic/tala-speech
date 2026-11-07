export const DEFERRED_NO_INPUT_TIMEOUT_MS = 1000 * 3600 * 24;

export const calculatePassivity = (
  expected_passivity?: number | null,
): number => {
  return (
    (expected_passivity ? expected_passivity * 1000 : expected_passivity) ??
    DEFERRED_NO_INPUT_TIMEOUT_MS
  );
};
