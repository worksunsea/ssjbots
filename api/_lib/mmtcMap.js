// Maps corporate_gifting_products rows (mmtc_gold / mmtc_silver) to the product
// title MMTC-PAMP shows on mmtcpamp.com. Keys are compared after normKey().
// Rows not listed here keep their old reference_price (and are reported).

export function normKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/24k \(999\.9\+\) purest|\(999\.9\+\) purest|22k \(916\.7\) pure/g, "")
    .replace(/(\d)\s*g(?:ms?)?\b/g, "$1g")
    .replace(/(\d)\s*kg\b/g, (_, d) => `${d}000g`)
    .replace(/(\d+)\.(\d*?)0*g/g, (_, a, b) => (b ? `${a}.${b}g` : `${a}g`))
    .replace(/[^a-z0-9.]/g, "");
}

// DB product name -> MMTC listing title
export const MMTC_TITLES = {
  "Laxmi Gold Coin": "5 g Lakshmi Gold Coin",
  "MMTC Lotus Gold Bar (1g)": "1 g Lotus Gold Bar",
  "MMTC Lotus Gold Bar (2g)": "2 g Lotus Gold Bar",
  "MMTC Lotus Gold Bar (5g)": "5 g Lotus Gold Bar",
  "MMTC Lotus Gold Bar (10g)": "10 g Lotus Gold Bar",
  "MMTC Lotus Gold Bar (20g)": "20 g Lotus Gold Bar",
  "MMTC Lotus Gold Bar (31.1g)": "31.1 g Lotus Gold Bar",
  "MMTC Lotus Gold Bar (50g)": "50 g Lotus Gold Bar",
  "MMTC Lotus Gold Bar (100g)": "100 g Lotus Gold Bar",
  "Lotus Gold Coin": "0.5 g Lotus Gold Coin",
  "Lotus Gold Coin (4g)": "4 g Lotus Gold Coin",
  "MMTC Laxmi Gold Bar": "10 g Laxmi Gold Bar",
  "Sone Ki Chidiya Gold Coin": "10 g Sone Ki Chidiya Gold Coin",
  "MMTC Shankh Ganesh Laxmi Gold Bar": "10 g Shankh Ganesh Laxmi Gold Coin Set (5 gm x 2)",
  "MMTC Ram Lalla Gold Bar": "10 g Ram Lalla Gold Bar",
  "MMTC Rose Gold Bar": "10 g Rose Gold Bar",
  "Rose Gold Oval Coin": "1 g Rose Gold Oval Coin",
  "MMTC Peacock Gold Bar": "2 g Peacock Gold Bar",
  "Laxmi Gold Oval Coin": "2 g Laxmi Gold Oval Coin",
  "Heaven on Earth Gold Coin": "5 g Heaven on Earth Gold Coin",
  "Shubh Aarambh Gold Coin": "5 g Shubh Aarambh Gold Coin",
  "Love Forever Gold Coin": "5 g Love Forever Gold Coin",
  "Shankh Laxmi Gold Coin": "20 g Shankh Laxmi Gold Coin",
  "Maharajadhiraj Rajaraam Gold Coin": "8 g Maharajadhiraj Rajaraam Gold Coin",
  "The Oxford Mint Sovereign Gold Coin (22K, 8g)": "8 g The Oxford Mint Sovereign Gold Coin",
  "MMTC Banyan Tree Silver Bar (10g)": "10 g Banyan Tree Silver Bar",
  "MMTC Banyan Tree Silver Bar (20g)": "20 g Banyan Tree Silver Bar",
  "MMTC Banyan Tree Silver Bar (50g)": "50 g Banyan Tree Silver Bar",
  "MMTC Banyan Tree Silver Bar (100g)": "100 g Banyan Tree Silver Bar",
  "Banyan Tree Silver Coin": "5 gm Banyan Tree Silver Coin",
  "Stylized Laxmi Ganesh Colored Silver": "50 g Stylized Laxmi Ganesh Colored Silver Bar",
  "Stylized Laxmi Ganesh Colored Silver (100g)": "100 g Stylized Laxmi Ganesh Colored Silver Bar",
  "MMTC Ram Lalla Colored Silver Bar": "50 g Ram Lalla Colored Silver Bar",
  "Ganesh Laxmi Silver Coin": "10 g Ganesh Laxmi Silver Coin",
  "MMTC Guru Nanak Dev Colored Silver Bar": "50 gm Guru Nanak Dev Colored Silver Bar",
  "Purest Casted Silver Bar": "250 g Casted Silver Bar",
  "Purest Casted Silver Bar (500g)": "500 g Casted Silver Bar",
  "Purest Casted Silver Bar (1kg)": "1kg Casted Silver Bar",
  "MMTC Laxmi Colored Silver Bar": "20 g Laxmi Colored Silver Bar",
  "Shankh Shape Ganesh Laxmi Coin": "50 g Shankh Shape Ganesh Laxmi Silver Coin, Set of (25.0 gms x 2)",
  "Lord Shiva Silver Bar": "50 g Lord Shiva Silver Bar",
  "Newborn Baby (Blue) Silver Coin": "20 g Newborn Baby (Blue) Silver Coin",
  "Lord Buddha Silver Bar": "50 g Lord Buddha Silver Bar",
  "Bouquet of Flower Silver Coin": "50 g Bouquet of Flower Silver Coin",
  "Lord Hanuman Silver Bar": "50 g Lord Hanuman Silver Bar",
  "Vaishno Devi Silver Coin": "50 g Vaishno Devi Silver Coin",
  "Ashta Laxmi Silver Coin": "50 g Ashta Laxmi Silver Coin",
  "Balaji Silver Bar": "50 g Balaji Silver Bar",
  "Sukh Samridhi Silver Bar": "100 g Sukh Samridhi Silver Bar",
  "Maharishi Mahesh Yogi Silver Coin": "31.10 g Maharishi Mahesh Yogi Silver Coin",
  "Adi Shankaracharya Silver Coin": "31.10 g Adi Shankaracharya Silver Coin",
  "Swami Brahmananda Saraswati Silver Coin": "31.10 g Swami Brahmananda Saraswati Silver Coin",
};

// Sanity band: MMTC price / (weight x our spot rate). Catches scrape errors.
export const RATIO_BAND = {
  mmtc_gold: [0.97, 1.3],
  mmtc_silver: [0.9, 2.0],
};
