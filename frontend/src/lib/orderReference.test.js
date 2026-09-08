import { formatEcommerceOrderReference } from "./orderReference";

describe("formatEcommerceOrderReference", () => {
  test("formats a Shopify order as a compact returns reference", () => {
    expect(formatEcommerceOrderReference({
      order_name: "#394U02934",
      shop_domain: "relifebattery.myshopify.com",
    })).toBe("SHP 394U02934");
  });

  test("distinguishes CSV, manual and internal WMS orders", () => {
    expect(formatEcommerceOrderReference({ order_name: "55", shop_domain: "csv-import" })).toBe("CSV 55");
    expect(formatEcommerceOrderReference({ order_name: "56", shop_domain: "manual-entry" })).toBe("MAN 56");
    expect(formatEcommerceOrderReference({ order_name: "TEST-1", shop_domain: "demo.aimago.local" })).toBe("WMS TEST-1");
  });

  test("does not duplicate an existing source prefix", () => {
    expect(formatEcommerceOrderReference({
      order_name: "SHP 394U02934",
      shop_domain: "relifebattery.myshopify.com",
    })).toBe("SHP 394U02934");
  });
});
