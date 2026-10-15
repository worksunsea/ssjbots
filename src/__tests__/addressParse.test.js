import { describe, it, expect } from "vitest";
import { parseAddress, normalizePincode, zoneFor, detectCity } from "../../api/_lib/addressParse.js";

const postal = {
  "110005": { district: "Central Delhi", state: "Delhi", offices: ["Karol Bagh", "Anand Parbat"] },
  "110009": { district: "North Delhi", state: "Delhi", offices: ["Model Town", "Derawal Nagar"] },
  "110092": { district: "East Delhi", state: "Delhi", offices: ["Preet Vihar"] },
  "110024": { district: "South Delhi", state: "Delhi", offices: ["Lajpat Nagar"] },
  "201301": { district: "Gautam Buddha Nagar", state: "Uttar Pradesh", offices: ["Noida"] },
};

describe("normalizePincode", () => {
  it("cleans spreadsheet leftovers and rejects junk", () => {
    expect(normalizePincode("201301.0")).toBe("201301");
    expect(normalizePincode(" 110005 ")).toBe("110005");
    expect(normalizePincode("DELHI-5")).toBe("110005");
    expect(normalizePincode("Delhi-95")).toBe("110095");
    expect(normalizePincode("Delhi-0")).toBe("");
    expect(normalizePincode("abc")).toBe("");
    expect(normalizePincode("012345")).toBe("");
    expect(normalizePincode(null)).toBe("");
  });
});

describe("parseAddress", () => {
  it("moves a trailing pincode and city out of the street text", () => {
    const r = parseAddress({ address_house: "B-63,Sector-5,Near Water Tank, Noida 201301" }, postal);
    expect(r.fields).toMatchObject({ address_house: "B-63,Sector-5,Near Water Tank", city: "Noida", address_state: "Uttar Pradesh", address_pincode: "201301" });
    expect(r.zone).toBe("Noida");
  });

  it("handles 'delhi-110092' written in the address", () => {
    const r = parseAddress({ address_house: "375, agcr enclave delhi-110092" }, postal);
    expect(r.fields.address_house).toBe("375, agcr enclave");
    expect(r.fields.address_pincode).toBe("110092");
    expect(r.fields.city).toBe("New Delhi");
    expect(r.zone).toBe("East Delhi");
  });

  it("fixes a '.0' pincode and fills city and state from it", () => {
    const r = parseAddress({ address_house: "House no:- B232", address_locality: "derawal nagar", address_pincode: "110009.0" }, postal);
    expect(r.fields).toMatchObject({ address_pincode: "110009", city: "New Delhi", address_state: "Delhi" });
    expect(r.zone).toBe("North Delhi");
  });

  it("finds a missing pincode from a well-known area name and says so", () => {
    const r = parseAddress({ address_house: "2695 mukherjee nagar" }, postal);
    expect(r.fields.address_pincode).toBe("110009");
    expect(r.sources.address_pincode).toMatch(/area name/i);
    expect(r.fields.address_locality).toBe("Mukherjee Nagar");
  });

  it("uses a post-office name for the area when the pincode is known", () => {
    const r = parseAddress({ address_house: "H-12 Karol Bagh", address_pincode: "110005" }, postal);
    expect(r.fields.address_locality).toBe("Karol Bagh");
    expect(r.zone).toBe("Central Delhi");
  });

  it("drops a duplicated locality and keeps unrelated text", () => {
    const r = parseAddress({ address_house: "D 904 express zenith sector 77 noida", address_locality: "D 904 express zenith sector 77 noida", city: "Noida", address_pincode: "201301.0" }, postal);
    expect(r.fields.address_locality).toBe("");
    expect(r.fields.address_house).toBe("D 904 express zenith sector 77");
  });

  it("prefers the real city over 'Delhi NCR' and drops a trailing U.P", () => {
    const r = parseAddress({ address_house: "r11/10, raj nagar, Ghaziabad, Delhi NCR, u.p" }, postal);
    expect(r.fields.city).toBe("Ghaziabad");
    expect(r.fields.address_state).toBe("Uttar Pradesh");
    expect(r.fields.address_house).not.toMatch(/u\.p/i);
    expect(r.zone).toBe("Ghaziabad");
  });

  it("reads the old 'Delhi-5' pincode style", () => {
    const r = parseAddress({ address_house: "MF-5 Bank Street", address_locality: "Karol Bagh", city: "DELHI", address_pincode: "DELHI-5" }, postal);
    expect(r.fields.address_pincode).toBe("110005");
    expect(r.zone).toBe("Central Delhi");
  });

  it("leaves foreign addresses alone and flags them", () => {
    const r = parseAddress({ address_house: "12 Maple Street", city: "Toronto", address_country: "Canada" }, postal);
    expect(r.fields).toEqual({});
    expect(r.zone).toBe("");
    expect(r.flags.join(" ")).toMatch(/outside India/);
  });

  it("never discards the street text when nothing can be worked out", () => {
    const r = parseAddress({ address_house: "Plot 5, Green Lane" }, postal);
    expect(r.fields.address_house).toBeUndefined();
    expect(r.flags.join(" ")).toMatch(/pincode/);
  });

  it("changes nothing for an already clean address", () => {
    const r = parseAddress({ address_house: "B-12", address_locality: "Karol Bagh", city: "New Delhi", address_state: "Delhi", address_pincode: "110005" }, postal);
    expect(r.fields).toEqual({});
    expect(r.zone).toBe("Central Delhi");
  });
});

describe("zoneFor / detectCity", () => {
  it("groups Delhi districts into the four working zones plus central", () => {
    expect(zoneFor("New Delhi", "South West Delhi")).toBe("West Delhi");
    expect(zoneFor("Delhi", "North East Delhi")).toBe("East Delhi");
    expect(zoneFor("Gurgaon", null)).toBe("Gurgaon");
    expect(zoneFor("New Delhi", null)).toBe("");
  });
  it("recognises common spellings", () => {
    expect(detectCity("gzb").city).toBe("Ghaziabad");
    expect(detectCity("Gurugram").city).toBe("Gurgaon");
    expect(detectCity("somewhere")).toBe(null);
  });
});
