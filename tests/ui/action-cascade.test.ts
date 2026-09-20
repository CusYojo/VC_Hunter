import { readFileSync } from "node:fs";
import postcss from "postcss";
import { expect, it } from "vitest";

it("keeps generic anchor inheritance in the base layer so action utility colors can win", () => {
  const css = postcss.parse(readFileSync("src/app/globals.css", "utf8"));
  css.walkRules("a", (rule) => {
    rule.walkDecls("color", () => {
      expect(rule.parent).toMatchObject({ type: "atrule", name: "layer", params: "base" });
    });
  });
});
