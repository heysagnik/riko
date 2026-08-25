import { describe, expect, it } from "vitest";
import {
  BRAND_TEMPLATE_DARK_CSS,
  DEFAULT_BRAND_TEMPLATE,
  renderBrandTemplate,
  validateBrandTemplate,
} from "./brand-template.js";

describe("validateBrandTemplate", () => {
  it("requires a content placeholder", () => {
    const result = validateBrandTemplate("<div>no slot here</div>");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("{{content}}");
  });

  it("rejects script tags", () => {
    const result = validateBrandTemplate("<div>{{content}}<script>alert(1)</script></div>");
    expect(result.valid).toBe(false);
  });

  it("rejects inline event handlers", () => {
    const result = validateBrandTemplate('<div onclick="steal()">{{content}}</div>');
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed template", () => {
    expect(validateBrandTemplate("<div>{{merchant_name}}{{content}}</div>").valid).toBe(true);
  });
});

describe("renderBrandTemplate", () => {
  it("injects content and merchant name", () => {
    const html = renderBrandTemplate("<main>{{merchant_name}}|{{content}}</main>", {
      content: "<p>hello</p>",
      merchantName: "Acme",
    });
    expect(html).toBe("<main>Acme|<p>hello</p></main>");
  });

  it("falls back to the default template when the placeholder is missing", () => {
    const html = renderBrandTemplate("<div>broken</div>", { content: "<p>hi</p>", merchantName: "Acme" });
    expect(html).toContain("<p>hi</p>");
    expect(html).not.toContain("broken");
  });

  it("falls back to the default template when none is set", () => {
    const html = renderBrandTemplate(null, { content: "<p>hi</p>", merchantName: "Acme" });
    expect(html).toContain("<p>hi</p>");
    expect(DEFAULT_BRAND_TEMPLATE).toContain("{{content}}");
  });

  it("escapes the merchant name but not the agent content", () => {
    const html = renderBrandTemplate("<div>{{merchant_name}}:{{content}}</div>", {
      content: "<p>kept</p>",
      merchantName: '<script>x</script>',
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<p>kept</p>");
  });

  it("replaces every occurrence of the merchant name", () => {
    const html = renderBrandTemplate("<h1>{{merchant_name}}</h1>{{content}}<footer>{{merchant_name}}</footer>", {
      content: "x",
      merchantName: "Acme",
    });
    expect(html.match(/Acme/g)).toHaveLength(2);
  });
});

describe("DEFAULT_BRAND_TEMPLATE theming", () => {
  it("declares dark-mode support and adapts to it", () => {
    expect(DEFAULT_BRAND_TEMPLATE).toContain('name="color-scheme" content="light dark"');
    expect(DEFAULT_BRAND_TEMPLATE).toContain("@media (prefers-color-scheme: dark)");
    expect(DEFAULT_BRAND_TEMPLATE).toContain(BRAND_TEMPLATE_DARK_CSS);
  });

  it("exposes class hooks for the CTA button and content", () => {
    expect(DEFAULT_BRAND_TEMPLATE).toContain('class="riko-body"');
    expect(DEFAULT_BRAND_TEMPLATE).toContain(".riko-btn { background: #f2f4f7 !important; }");
    expect(DEFAULT_BRAND_TEMPLATE).toContain(".riko-btn-label { color: #111111 !important; }");
  });

  it("keeps inline light styles as the fallback for clients without dark support", () => {
    expect(DEFAULT_BRAND_TEMPLATE).toContain("background:#ffffff");
    expect(DEFAULT_BRAND_TEMPLATE).not.toContain("background:#ffffff !important");
  });

  it("renders the themed default when no template is set", () => {
    const html = renderBrandTemplate(null, { content: "<p>hi</p>", merchantName: "Acme" });
    expect(html).toContain("@media (prefers-color-scheme: dark)");
  });
});
