import assert from "node:assert/strict";
import { test } from "node:test";

import { calculatePassivity } from "../src/passivity.ts";

interface PassivityCase {
  name: string;
  input?: number | null;
  expected: number;
}

const cases: PassivityCase[] = [
  {
    name: "defaults to 24 hours when expected passivity is missing",
    input: undefined,
    expected: 86_400_000,
  },
  {
    name: "defaults to 24 hours when expected passivity is null",
    input: null,
    expected: 86_400_000,
  },
  {
    name: "preserves zero passivity",
    input: 0,
    expected: 0,
  },
  {
    name: "converts expected passivity seconds to milliseconds",
    input: 1.5,
    expected: 1_500,
  },
];

for (const { name, input, expected } of cases) {
  test(name, () => {
    assert.equal(calculatePassivity(input), expected);
  });
}
