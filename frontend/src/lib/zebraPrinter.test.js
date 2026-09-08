import { buildZebraPackingLabel } from "./zebraPrinter";

const shopifyLabel = {
  code: "PK-ABCDEF123456",
  order_name: "#394U02934",
  shop_domain: "relifebattery.myshopify.com",
  recipient_name: "Mario Rossi",
  address1: "Via Roma 69",
  zip: "00162",
  city: "Roma",
  province: "RM",
  country: "Italia",
};

test.each(["brt", "gls"])("prints the ecommerce reference on the %s label edge", (carrier) => {
  const zpl = buildZebraPackingLabel({ ...shopifyLabel, carrier });
  expect(zpl).toContain("^FO39,220^A0R,16,16^FDRESI SHP 394U02934^FS");
  expect(zpl).toContain("^FDORD #394U02934");
});
