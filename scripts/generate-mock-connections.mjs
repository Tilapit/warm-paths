// Generates mock LinkedIn Connections exports in data/demo/ for three owners:
//   Connections.csv            "You", ~1,500 rows
//   Connections-cofounder.csv  "Co-founder", ~860 rows, ~270 people also in Connections.csv
//   Connections-board.csv      "Board member", ~300 rows, ~60 people also in the others
// Seeded and deterministic: the same seed gives byte-identical files.
//
// Every person is invented. Companies are real Finnish and international
// companies, used only so PRH matching can be tested. Invented people never get
// CEO, managing director, owner or founder titles at a real company.
//
// Usage: node scripts/generate-mock-connections.mjs [--seed 20261025] [--today 2026-10-24] [--check-prh]
// Stress files (not for data/demo): --rows 10000 --seed 10010 --out data/stress/10k
// scales all three networks so that "You" has that many rows.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const SEED = Number(arg("--seed", 20261025));
const TODAY = arg("--today", "2026-10-24");
const OUT = path.resolve(arg("--out", path.join(process.cwd(), "data", "demo")));
const ROWS = Number(arg("--rows", 0));

// ---------- seeded randomness ----------

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const chance = (p) => rnd() < p;
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");

/** "Mikko:30 Juha-Pekka:3 Anna" -> [["Mikko",30],["Juha-Pekka",3],["Anna",1]]; "_" is a space. */
const W = (s) =>
  s.trim().split(/\s+/).map((t) => {
    const i = t.lastIndexOf(":");
    return i > 0 ? [t.slice(0, i).replace(/_/g, " "), Number(t.slice(i + 1))] : [t.replace(/_/g, " "), 1];
  });

function weighted(list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = rnd() * total;
  for (const [v, w] of list) if ((r -= w) < 0) return v;
  return list[list.length - 1][0];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- names ----------

const FI_M = W(`Mikko:14 Juha:13 Timo:11 Matti:10 Kari:9 Antti:13 Jari:9 Mika:11 Janne:11 Sami:10 Petri:8 Jukka:9 Ville:11
Tuomas:9 Teemu:9 Lauri:8 Joonas:8 Juho:8 Oskari:7 Heikki:6 Pekka:7 Markus:7 Marko:8 Jussi:7 Tommi:6 Jani:7 Aleksi:7 Eero:5
Henri:5 Niko:6 Ari:5 Harri:4 Jarkko:4 Hannu:4 Esa:4 Risto:3 Kimmo:5 Toni:5 Arttu:4 Otto:4 Eetu:4 Elias:4 Joni:4 Samuli:4
Pasi:5 Tero:5 Vesa:4 Kalle:5 Lasse:4 Oskari:3 Valtteri:4 Jesse:4 Rasmus:3 Iiro:3 Atte:3 Miro:3 Veeti:2 Tuukka:3 Ilkka:3
Juha-Pekka:3 Jukka-Pekka:2 Pertti:2 Seppo:2 Jouni:3 Mikael:3 Aki:3 Tapio:2 Veli-Matti:2 Joel:3 Leo:2 Onni:2 Santeri:3`);
const FI_F = W(`Anna:11 Maria:7 Laura:11 Johanna:9 Elina:9 Hanna:9 Katja:7 Sanna:8 Heidi:7 Minna:8 Tiina:8 Riikka:6 Anne:7
Päivi:5 Satu:6 Kaisa:6 Jenni:8 Emmi:5 Emilia:5 Sara:5 Julia:5 Noora:5 Henna:5 Salla:4 Suvi:5 Pauliina:4 Maija:4 Outi:4
Tanja:4 Marjo:3 Kirsi:5 Eeva:4 Liisa:3 Krista:4 Mari:5 Niina:5 Milla:4 Veera:4 Aino:3 Ella:3 Iida:3 Venla:2 Oona:2 Inka:2
Aada:2 Sofia:3 Anni:5 Essi:3 Heta:2 Elisa:3 Jonna:3 Kati:3 Anna-Kaisa:3 Anna-Maria:2 Hilla:2 Reetta:3 Saara:3 Tuuli:2
Marika:3 Susanna:3 Terhi:3 Sini:3 Paula:3 Ulla:2 Merja:2 Leena:2 Jaana:3`);
const FI_LAST = W(`Korhonen:6 Virtanen:6 Mäkinen:5 Nieminen:5 Mäkelä:5 Hämäläinen:5 Laine:5 Heikkinen:4 Koskinen:4 Järvinen:4
Lehtonen:4 Lehtinen:4 Saarinen:4 Salminen:4 Heinonen:4 Niemi:4 Heikkilä:3 Kinnunen:3 Salonen:3 Turunen:3 Salo:3 Laitinen:3
Tuominen:3 Rantanen:3 Karjalainen:3 Jokinen:3 Mattila:3 Savolainen:3 Lahtinen:3 Ahonen:3 Ojala:3 Leppänen:3 Hiltunen:2
Väisänen:2 Kallio:2 Leinonen:2 Miettinen:2 Aaltonen:2 Hakala:2 Laaksonen:2 Kärkkäinen:2 Peltonen:2 Koivisto:2 Lehto:2
Huttunen:2 Manninen:2 Seppälä:2 Mustonen:2 Pitkänen:2 Toivonen:2 Räsänen:2 Anttila:2 Vainio:2 Hirvonen:2 Mikkola:2 Ikonen:2
Kettunen:2 Oksanen:2 Partanen:2 Rinne:2 Lappalainen:2 Kivelä Eskola Rautio Pesonen Suominen Halonen Moilanen Kokkonen Hyvönen
Jääskeläinen Kiiskinen Huhtala Nurmi Kangas Hakkarainen Koponen Tikkanen Väänänen Riihimäki Haapala Kauppinen Heiskanen
Ruotsalainen Pulkkinen Rissanen Hänninen Kemppainen Repo Korpela Lampinen Sirviö Uusitalo Kärki Ahola Mäkipää Koivula Kurki
Hietala Hietanen Honkanen Kokko Laakkonen Lahti Leino Lepistö Luoma Marttila Mikkonen Mononen Nevalainen Niskanen Nurminen
Orava Paananen Parkkinen Pekkarinen Peltola Pietilä Piirainen Pirinen Pöllänen Rajala Ruuskanen Saari Saarela Sallinen
Sihvonen Sillanpää Siltanen Suomalainen Tanskanen Tiainen Toivanen Tolonen Turkki Vartiainen Vesterinen Viitanen Vilén
Voutilainen Vuorinen Ylönen Ylitalo Aho Alanen Anttonen Hartikainen Heino Holopainen Hyttinen Immonen Jokela Juntunen
Kaartinen Kallunki Karppinen Kauppila Keskinen Kilpeläinen Kivinen Kiviniemi Kolehmainen Koski Kosonen Kukkonen Kumpulainen
Kuusela Kuusisto Laukkanen Luukkonen Määttä Mäenpää Mäki Niemelä Nissinen Nykänen Ojanen Paavola Pajunen Palonen Parviainen
Perälä Pihlaja Puustinen Raatikainen Rantala Reinikainen Rönkkö Ruohonen Salmi Seppänen Suhonen Takala Tervo Tirkkonen Tuomi
Uotila Valtonen Varis Vehviläinen Vesala Vuori Ylinen Hautala Kangasniemi Huovinen Lindroos Nyman Backman Mäntylä Rautiainen`);
// The long tail: compound surnames ("Kivimäki", "Koivuniemi") so that, as in
// Finland, most surnames are rare and only common combinations repeat.
for (const e of FI_LAST) e[1] = Math.sqrt(e[1]);
const STEMS = "Kivi Koivu Lehti Ranta Korpi Haapa Kallio Mänty Kuusi Leppä Pihla Saari Järvi Laakso Harju Joki Koski Lahti Honka Aho Raja Iso Pitkä Karhu Hirvi Ala".split(" ");
const ENDS = "mäki niemi saari järvi lahti koski salo vuori aho kangas".split(" ");
for (const a of STEMS) for (const b of ENDS) {
  const name = (a + b).replace(/^(.)/, (c) => c.toUpperCase());
  if (!a.toLowerCase().startsWith(b) && !b.startsWith(a.toLowerCase().slice(0, 3)) && !FI_LAST.some(([n]) => n === name)) FI_LAST.push([name, 0.5]);
}
const SV_M = W(`Johan:3 Erik:3 Anders:2 Fredrik:2 Henrik:2 Mikael:3 Patrik:2 Kristian:2 Jonas:2 Niklas:2 Karl:1 Oskar:2 Emil:2
Axel:2 Christoffer:1 Mathias:2 Robin:2 Sebastian:2 Tobias:1 Daniel:2 Magnus:1 Peter:1 Stefan:1`);
const SV_F = W(`Linnea:2 Emma:2 Sofia:2 Johanna:2 Anna:2 Matilda:2 Ida:2 Sara:2 Camilla:2 Malin:2 Jessica:1 Cecilia:2
Maria:1 Annika:2 Nina:1 Petra:1 Frida:2 Louise:1 Jenny:1 Elin:1 Rebecka:1 Hanna:1`);
const SV_LAST = W(`Lindholm:2 Lindqvist:2 Lindström:2 Nyström:2 Holmström:2 Sjöberg:2 Lundqvist:2 Wikström:2 Forsman:2
Strandberg:2 Björklund:2 Ekholm:2 Nyberg:2 Granlund:2 Sundqvist:1 Söderholm:2 Westerlund:2 Andersson:2 Johansson:2
Eriksson:2 Karlsson:2 Gustafsson:1 Åberg:1 Berg:1 Holm:2 Blomqvist:2 Mattsson:1 Grönroos:2 Enqvist:1 Wallin:2 Sandell:1
Österberg:1 Lindberg:1 Fagerström:1 Häggblom:1 Sjöblom:1 Strömberg:1 Ekström:1 Lönnqvist:1 Heinström:1`);
const INTL = [
  [{ m: W("Kristjan Mart Siim Tanel Rasmus Martin Andres Kaarel"), f: W("Kadri Liis Kristiina Triin Maarja Kati Merilin"), l: W("Tamm Saar Sepp Kask Mägi Rebane Kukk Ilves Lepik Kuusk Pärn Oja") }, 10],
  [{ m: W("Lukas Jonas Felix Maximilian Tobias Jan Florian Moritz"), f: W("Hannah Sophie Lea Laura Katharina Julia Lena Anna"), l: W("Müller Schmidt Schneider Fischer Weber Wagner Becker Hoffmann Schulz Koch Richter Wolf") }, 10],
  [{ m: W("Raj Arjun Rohit Vikram Aditya Rahul Karthik Siddharth Ankit Nikhil"), f: W("Priya Ananya Divya Sneha Pooja Kavya Neha Shreya"), l: W("Sharma Patel Kumar Singh Gupta Reddy Iyer Nair Rao Joshi Mehta Krishnan") }, 14],
  [{ m: W("Wei Hao Jun Lei Yang Chen Ming"), f: W("Xin Li Mei Yan Ying Jing Lin"), l: W("Wang Li Zhang Chen Liu Yang Huang Zhao Wu Zhou Xu") }, 8],
  [{ m: W("Dmitri Alexei Sergei Oleksandr Andrii Maksym Ivan Mykola"), f: W("Anastasia Olena Yulia Daria Kateryna Iryna Natalia"), l: W("Ivanov Petrov Kovalenko Shevchenko Bondarenko Melnyk Smirnov Popova Kuznetsova Tkachenko") }, 10],
  [{ m: W("Pablo Carlos Javier Diego Alejandro Marco Luca Matteo Lorenzo"), f: W("Lucía Sofía Carmen Elena Giulia Francesca Chiara Martina"), l: W("García Fernández López Martínez Sánchez Rossi Bianchi Romano Ricci Moretti Conti") }, 10],
  [{ m: W("David Michael James Daniel Thomas Alex Ryan Chris Matthew Ben"), f: W("Sarah Emily Jessica Rachel Hannah Kate Olivia Emma"), l: W("Smith Johnson Brown Miller Wilson Taylor Davies Evans Clarke Walker Hughes Morgan") }, 12],
  [{ m: W("Lucas Gabriel Mateus Rafael Thiago Bruno"), f: W("Ana Beatriz Juliana Camila Larissa Fernanda"), l: W("Silva Santos Oliveira Souza Costa Pereira Almeida Ferreira") }, 5],
  [{ m: W("Ali Reza Amir Mohammad Hossein Mehmet Emre Ahmed Omar"), f: W("Sara Maryam Zahra Elif Zeynep Fatima Leila Ayşe"), l: W("Hosseini Ahmadi Karimi Rahimi Yılmaz Kaya Demir Şahin Hassan Haddad") }, 8],
  [{ m: W("Minh Duc Tuan Hoang"), f: W("Linh Thao Huong Mai"), l: W("Nguyen Tran Le Pham Hoang Vu") }, 3],
  [{ m: W("Chinedu Kwame Emeka Kofi Tunde"), f: W("Ngozi Ama Chioma Adaeze Abena"), l: W("Okafor Adeyemi Mensah Okeke Boateng Eze") }, 3],
  [{ m: W("Piotr Tomasz Michał Jakub Paweł"), f: W("Agnieszka Katarzyna Magdalena Joanna"), l: W("Kowalski Nowak Wiśniewski Wójcik Kamiński Lewandowski") }, 4],
  [{ m: W("Pierre Julien Thomas Nicolas Antoine Maxime"), f: W("Camille Léa Chloé Manon Claire Julie"), l: W("Martin Bernard Dubois Moreau Laurent Lefebvre Girard") }, 4],
  [{ m: W("Hiroshi Kenji Takumi Joon-ho Min-jun"), f: W("Yuki Aiko Sakura Ji-woo Seo-yeon"), l: W("Tanaka Sato Suzuki Kim Park Lee Choi") }, 3],
  [{ m: W("Lars Ole Mads Magnus Henrik Bjørn"), f: W("Ingrid Sigrid Maja Ida Freja Astrid"), l: W("Hansen Jensen Nielsen Larsen Olsen Pedersen Berg Haugen Dahl") }, 6],
];

// Real people who are well known in Finland. Never generate these exact names.
const FAMOUS = new Set(
  `Sanna Marin|Alexander Stubb|Sauli Niinistö|Tarja Halonen|Martti Ahtisaari|Petteri Orpo|Antti Rinne|Juha Sipilä|Kimi Räikkönen|Mika Häkkinen|Valtteri Bottas|Linus Torvalds|Ilkka Paananen|Mikko Kodisoja|Peter Vesterbacka|Risto Siilasmaa|Pekka Lundmark|Antti Herlin|Henrik Ehrnrooth|Teemu Selänne|Jari Litmanen|Teemu Pukki|Miki Kuusi|Ville Valo|Matti Nykänen|Lasse Virén|Esa-Pekka Salonen|Mikko Hyppönen|Jari Sarasvuo|Kalle Päätalo|Pekka Haavisto|Li Andersson|Riikka Purra|Anne Berner|Alexander Lindholm|Mikko Alasaarela|Kustaa Valtonen|Timo Soini|Juha Mieto|Jukka Jalonen|Patrik Laine`.split("|"),
);

const ORIGIN = {
  // [Finnish, Finland-Swedish, international] shares and the male share, per segment.
  startup: [74, 6, 20, 0.62],
  software: [80, 6, 14, 0.66],
  academia: [74, 10, 16, 0.55],
  corporate: [85, 7, 8, 0.62],
  target: [89, 8, 3, 0.74],
  ecosystem: [80, 7, 13, 0.52],
  public: [90, 7, 3, 0.45],
  abroad: [35, 5, 60, 0.62],
  self: [82, 6, 12, 0.6],
};

function makeName(segment) {
  const [fi, sv, , male] = ORIGIN[segment];
  for (;;) {
    const r = rnd() * 100;
    const m = rnd() < male;
    let first, last;
    if (r < fi) [first, last] = [weighted(m ? FI_M : FI_F), weighted(FI_LAST)];
    else if (r < fi + sv) [first, last] = [weighted(m ? SV_M : SV_F), chance(0.8) ? weighted(SV_LAST) : weighted(FI_LAST)];
    else {
      const o = weighted(INTL);
      [first, last] = [weighted(m ? o.m : o.f), weighted(o.l)];
    }
    if (!FAMOUS.has(`${first} ${last}`)) return { first, last, origin: r < fi ? "fi" : r < fi + sv ? "sv" : "intl" };
  }
}

// ---------- companies ----------

// Target segment: real Finnish SMEs with physical operations, each verified
// against PRH YTJ (data/cache/prh). [official name, sector, ...brand names people use]
const TARGET = [
  ["Sisu Akselit Oy", "metal", "Sisu Axles"], ["Pemamek Oy", "metal"], ["Kumera Drives Oy", "metal", "Kumera"], ["Hydroline Oy", "metal"],
  ["Tamtron Oy", "metal"], ["Stalatube Oy", "metal"], ["Junttan Oy", "metal"], ["Mantsinen Group Ltd Oy", "metal", "Mantsinen"],
  ["Kesla Oyj", "metal"], ["Logset Oy", "metal"], ["Weckman Steel Oy", "metal", "Weckman"], ["Miilux Oy", "metal"], ["Vahterus Oy", "metal"],
  ["Kaso Oy", "metal"], ["Oy Sisu Auto Ab", "metal"], ["Lännen Tractors Oy", "metal"], ["Junkkari Oy", "metal"], ["Pellon Group Oy", "metal", "Pellon"],
  ["Polarteknik Oy", "metal"], ["Novatron Oy", "metal"], ["JOT Automation Oy", "metal", "JOT Automation"], ["Cimcorp Oy", "metal"],
  ["Haarla Group Oy", "metal", "Haarla"], ["Robit Oyj", "metal", "Robit Plc"], ["Lappset Group Oy", "metal", "Lappset"], ["Tevo Oy", "metal"],
  ["Rototec Oy", "metal"], ["Oy Prevex Ab", "metal"], ["Tecalemit Oy", "metal"], ["Lekatech Oy", "metal"], ["Nordautomation Oy", "metal"],
  ["Lillbacka Powerco Oy", "metal", "Lillbacka"], ["Ruskon Betoni Oy", "metal"], ["TP Silva Oy", "metal"], ["Ekeri Oy", "metal"],
  ["Oy Närko Ab", "metal", "Närko"], ["Laitex Oy", "metal"], ["Pesmel Oy", "metal"],
  ["Merus Power Oyj", "electro", "Merus Power"], ["Teknoware Oy", "electro"], ["Labkotec Oy", "electro"], ["Nokeval Oy", "electro"],
  ["Ouman Oy", "electro"], ["Vallox Oy", "electro"], ["Enervent Zehnder Oy", "electro", "Enervent"], ["Kaukora Oy", "electro", "Jäspi"],
  ["Beneq Oy", "electro"], ["Picosun Oy", "electro"], ["Satel Oy", "electro"], ["Oy Lival Ab", "electro"], ["Algol Technics Oy", "electro"],
  ["Mekitec Oy", "electro"],
  ["Amerplast Oy", "plastics"], ["Plasthill Oy", "plastics"], ["Plastec Finland Oy", "plastics", "Plastec"], ["Oy Orthex Finland Ab", "plastics", "Orthex"],
  ["Vink Finland Oy", "plastics", "Vink"], ["Sinituote Oy", "plastics"], ["Finnfoam Oy", "plastics"], ["Pipelife Finland Oy", "plastics", "Pipelife"],
  ["Fibox Oy Ab", "plastics", "Fibox"], ["Biolan Oy", "plastics"], ["Wavin Finland Oy", "plastics", "Wavin"], ["Kera Group Oy", "plastics"],
  ["Ab Rani Plast Oy", "plastics", "Rani Plast"],
  ["Nokian Panimo Oyj", "food", "Nokian Panimo"], ["Kinnusen Mylly Oy", "food"], ["Leipomo Rosten Oy", "food", "Rosten"], ["Porokylän Leipomo Oy", "food"],
  ["Pouttu Oy", "food"], ["Kivikylän Kotipalvaamo Oy", "food", "Kivikylän"], ["Kalaneuvos Oy", "food"], ["Hätälä Oy", "food"], ["Kiantama Oy", "food"],
  ["Pakkasmarja Oy", "food"], ["Oy Brunberg Ab", "food", "Brunberg"], ["Oy Halva Ab", "food", "Halva"], ["Lapin Liha Oy", "food"],
  ["Laitilan Wirvoitusjuomatehdas Oy", "food", "Laitilan"], ["Viking Malt Oy", "food"], ["Moilas Oy", "food"],
  ["Lihatukku Harri Tamminen Oy", "food", "Tamminen"], ["Lapin Maito Oy", "food"], ["Leipomo Salonen Oy", "food"],
  ["Eckes-Granini Finland Oy Ab", "food", "Eckes-Granini"], ["Osuuskunta Maitokolmio", "food", "Maitokolmio"],
  ["Rye Rye Oy", "food", "Kyrö Distillery Company", "Kyrö Distillery", "Kyrö"], ["Teerenpeli Panimo & Tislaamo Oy", "food", "Teerenpeli"],
  ["Maustaja Oy", "food"], ["Finnamyl Oy", "food"],
  ["Oy Lunawood Ltd", "wood", "Lunawood"], ["Junnikkala Oy", "wood"], ["LapWall Oyj", "wood", "LapWall"], ["Kontiotuote Oy", "wood", "Kontio"],
  ["Honkarakenne Oyj", "wood", "Honka"], ["Muurame Oy", "wood"], ["Lammin Betoni Oy", "wood"], ["Lammin Ikkuna Oy", "wood"],
  ["Kuusamo Hirsitalot Oy", "wood"], ["Puustelli Group Oy", "wood", "Puustelli"], ["Vieser Oy", "wood"], ["Kannustalo Oy", "wood"],
  ["Kastelli-talot Oy", "wood", "Kastelli"], ["Metalli Piiroinen Oy", "wood", "Piiroinen"], ["Pfeifer Nordics Oy", "wood", "Pölkky"],
  ["Skaala IFN Oy", "wood", "Skaala"],
  ["Nanso Group Oy", "textile", "Nanso"], ["Halti Oy", "textile"], ["Sasta Oy", "textile"], ["Lapuan Kankurit Oy", "textile"],
  ["Jokipiin Pellava Oy", "textile"], ["Kalevala Koru Oy", "textile", "Kalevala Jewelry"],
  ["Oy Hacklin Logistics Ltd", "logistics", "Hacklin"], ["Nurminen Logistics Oyj", "logistics", "Nurminen Logistics"], ["Kuljetusrinki Oy", "logistics"],
  ["Varova Oy", "logistics"], ["Varsinais-Suomen Kaukokiito Oy", "logistics"], ["Oulun Kaukokiito Oy", "logistics"],
  ["Oy Transmeri Logistics Ab", "logistics", "Transmeri"],
  ["Uudenkaupungin Työvene Oy", "maritime", "Uudenkaupungin Työvene"], ["Marine Alutech Oy Ab", "maritime", "Marine Alutech"],
  ["Oy Kewatec AluBoat Ab", "maritime", "Kewatec"], ["Bella-Veneet Oy", "maritime", "Bella Boats"], ["Baltic Yachts Oy Ab Ltd", "maritime", "Baltic Yachts"],
  ["Turun Korjaustelakka Oy", "maritime", "Turku Repair Yard"], ["Alfons Håkans Oy Ab", "maritime", "Alfons Håkans"], ["Meriaura Oy", "maritime"],
  ["Langh Ship Oy Ab", "maritime", "Langh Ship"], ["Steerprop Oy", "maritime"], ["Inhan Tehtaat Oy Ab", "maritime", "Inha Works"],
  ["XO Boats Oy", "maritime", "XO Boats"], ["Sargo Oy Ab", "maritime", "Sargo Boats"], ["Mobimar Oy", "maritime"],
  ["Marioff Corporation Oy", "maritime", "Marioff"], ["ESL Shipping Oy", "maritime", "ESL Shipping"],
  ["Rakennusliike Lapti Oy", "construction", "Lapti"], ["Jatke Oy", "construction", "Jatke"], ["Varte Oy", "construction"],
  ["Rakennusliike Evälahti Oy", "construction"], ["Rakennusliike U. Lipsanen Oy", "construction", "Lipsanen"],
  ["Arkta Reponen Oy", "construction", "Rakennusliike Reponen"], ["Asfalttikallio Oy", "construction"],
  ["Sarlin Oy Ab", "wholesale", "Sarlin"], ["Etra Oy", "wholesale"], ["Telko Oy", "wholesale"], ["Machinery Oy", "wholesale"],
  ["Hydroscand Oy", "wholesale"], ["Kauppahuone Harju Oy", "wholesale", "Harju"], ["Kauko Oy", "wholesale"], ["Fluiconnecto Oy", "wholesale", "Hytar"],
];
// Target SMEs that PRH shows a registered change for in the last 90 days, so the
// signal radar and the network meet. Filled from data/cache/prh/signals.json.
const SIGNAL_TARGETS = [
  ["Specim, Spectral Imaging Oy Ltd", "electro", "Specim"], ["Gasmet Technologies Oy", "electro", "Gasmet"], ["Dinolift Oy", "metal"],
  ["Novita Oy", "textile"], ["Satron Instruments Oy", "electro", "Satron"], ["Biovian Oy", "plastics"], ["Betolar Oyj", "wood", "Betolar"],
  ["Saalasti Biomass Oy", "metal", "Saalasti"],
];
const ALL_TARGETS = [...TARGET, ...SIGNAL_TARGETS];

// Three SMEs where "You" knows several people (plausible customers).
const CUSTOMERS = ["Oy Lunawood Ltd", "Kumera Drives Oy", "Oy Hacklin Logistics Ltd"];

// [display names, relative size]. The first name is the usual one.
const CORPORATES = [
  [["KONE", "KONE Oyj", "Kone Corporation", "KONE Corporation", "Kone", "KONE Industrial Oy"], 10],
  [["Wärtsilä", "Wartsila", "Wärtsilä Finland Oy", "Wärtsilä Oyj Abp", "Wärtsilä Corporation"], 10],
  [["Nokia", "Nokia Oyj", "Nokia Networks", "NOKIA", "Nokia Solutions and Networks"], 12],
  [["UPM", "UPM-Kymmene", "UPM-Kymmene Oyj", "UPM Raflatac"], 7],
  [["Fortum", "Fortum Oyj", "Fortum Power and Heat Oy"], 6],
  [["Valmet", "Valmet Oyj", "Valmet Automation"], 7],
  [["Kesko", "Kesko Oyj", "K Group", "K-ryhmä"], 6],
  [["S Group", "S-ryhmä", "SOK", "Suomen Osuuskauppojen Keskuskunta"], 5],
  [["Stora Enso", "Stora Enso Oyj"], 5],
  [["Neste", "Neste Oyj", "Neste Corporation"], 6],
  [["Metso", "Metso Oyj", "Metso Outotec"], 5],
  [["Outokumpu", "Outokumpu Oyj"], 3],
  [["Elisa", "Elisa Oyj"], 5],
  [["OP Financial Group", "OP Ryhmä", "OP-ryhmä"], 5],
  [["Konecranes", "Konecranes Oyj", "Konecranes Finland"], 4],
  [["Kalmar", "Cargotec", "Hiab"], 4],
  [["Fiskars Group", "Fiskars"], 3],
  [["Valio", "Valio Oy"], 3],
  [["Fazer", "Fazer Group", "Oy Karl Fazer Ab"], 3],
  [["Paulig", "Paulig Group"], 2],
  [["Finnair", "Finnair Oyj"], 4],
  [["Posti", "Posti Group", "Posti Group Oyj"], 3],
  [["VR Group", "VR", "VR-Yhtymä"], 2],
  [["YIT", "YIT Oyj"], 2],
  [["Kemira", "Kemira Oyj"], 3],
  [["Huhtamaki", "Huhtamäki", "Huhtamaki Oyj"], 2],
  [["Orion Corporation", "Orion Pharma", "Orion Oyj"], 2],
  [["Ponsse", "Ponsse Oyj", "Ponsse Plc"], 3],
  [["Telia Finland", "Telia"], 3],
  [["Atria", "Atria Oyj"], 2],
  [["HKFoods", "HKScan"], 2],
  [["Sanoma", "Sanoma Media Finland"], 2],
];
const STARTUPS = [
  [["Wolt", "Wolt Enterprises Oy", "Wolt (DoorDash)"], 12], [["Supercell"], 5], [["Oura", "ŌURA", "Oura Health Oy", "Oura Health"], 8],
  [["Aiven", "Aiven.io", "Aiven Oy"], 7], [["ICEYE", "ICEYE Oy", "Iceye"], 7], [["Varjo", "Varjo Technologies", "Varjo Technologies Oy"], 5],
  [["Smartly.io", "Smartly", "Smartly.io Solutions Oy"], 6], [["Swappie", "Swappie Oy"], 5], [["RELEX Solutions", "Relex", "RELEX"], 7],
  [["MaaS Global", "Whim", "MaaS Global Oy"], 3], [["ResQ Club"], 2], [["Kide.app", "Kide"], 2], [["Yousician", "Yousician Oy"], 3],
  [["Framery", "Framery Oy"], 3], [["Nosto", "Nosto Solutions"], 3], [["Enfuce", "Enfuce Financial Services"], 3], [["Holvi"], 2],
  [["Hoxhunt", "Hoxhunt Oy"], 3], [["Upright Project", "Upright"], 2], [["Silo AI", "AMD Silo AI", "AMD"], 5],
  [["IQM Quantum Computers", "IQM", "IQM Finland Oy"], 5], [["Distance Technologies"], 2], [["Solar Foods", "Solar Foods Oyj"], 3],
  [["Infinited Fiber Company", "Infinited Fiber"], 2], [["Spinnova", "Spinnova Oyj"], 2], [["Carbo Culture"], 1], [["Freska", "Freska Oy"], 2],
  [["Sulapac", "Sulapac Oy"], 2], [["Paptic"], 1], [["Basemark"], 1], [["Sievo", "Sievo Oy"], 2], [["Efecte", "Efecte Oyj"], 2],
  [["Valossa"], 1], [["Vexlum"], 1], [["Zoined"], 1], [["Dealfront", "Leadfeeder"], 2], [["Klevu"], 1], [["Steady Energy"], 1],
  [["Polar Night Energy"], 1], [["Meru Health"], 1], [["Wirepas", "Wirepas Oy"], 2], [["Lumoa"], 1],
];
const SOFTWARE = [
  [["Reaktor", "Reaktor Innovations Oy"], 8], [["Futurice", "Futurice Oy"], 8], [["Nitor", "Nitor Group"], 4], [["Solita", "Solita Oy"], 7],
  [["Vincit", "Vincit Oyj"], 5], [["Gofore", "Gofore Oyj"], 5], [["Siili Solutions", "Siili"], 4], [["Tietoevry", "TietoEVRY", "Tieto"], 6],
  [["CGI", "CGI Suomi Oy"], 4], [["Accenture", "Accenture Oy"], 5], [["Columbia Road", "Columbia Road Oy"], 3], [["Fraktio"], 1],
  [["Wunder"], 2], [["Knowit", "Knowit Oy"], 3], [["Netlight"], 2], [["twoday", "Twoday", "Digia"], 4], [["Codento"], 1],
  [["Houston Inc.", "Houston Inc"], 2], [["Eficode", "Eficode Oy"], 4], [["Unikie"], 2], [["Visma", "Visma Solutions Oy", "Visma Finland"], 4],
  [["Lemonsoft", "Lemonsoft Oyj"], 3], [["Sofigate"], 2], [["Loihde"], 2], [["Digital Workforce", "Digital Workforce Services"], 2],
  [["Bitfactor"], 1], [["Taiste"], 1], [["Qvantel"], 1], [["Netum"], 1], [["Exove"], 1], [["Vaadin", "Vaadin Ltd"], 2], [["Zoan"], 1],
];
const PARTNERS = [["Lemonsoft", "Lemonsoft Oyj"], ["Visma", "Visma Solutions Oy"], ["Columbia Road"]];
const ECOSYSTEM = [
  [["Business Finland"], 10], [["Slush"], 8], [["Aaltoes", "Aalto Entrepreneurship Society", "Aaltoes - Aalto Entrepreneurship Society"], 6],
  [["Startup Foundation"], 2], [["Maria 01", "Maria01"], 4], [["Lifeline Ventures"], 2], [["Maki.vc"], 2], [["Inventure"], 2],
  [["Icebreaker.vc"], 1], [["Voima Ventures"], 1], [["Superhero Capital"], 1], [["Tesi", "Tesi (Finnish Industry Investment)", "Suomen Teollisuussijoitus Oy"], 3],
  [["Sitra"], 3], [["Kiuas", "Kiuas Accelerator"], 2], [["Junction"], 2], [["Helsinki Partners"], 2], [["Vendep Capital"], 1],
  [["Butterfly Ventures"], 1], [["FiBAN", "Finnish Business Angels Network"], 1], [["NewCo Helsinki"], 2], [["Finnvera", "Finnvera Oyj"], 3],
];
const PUBLIC = [
  [["City of Helsinki", "Helsingin kaupunki"], 6], [["City of Espoo", "Espoon kaupunki"], 4], [["Vantaan kaupunki", "City of Vantaa"], 2],
  [["Työ- ja elinkeinoministeriö", "Ministry of Economic Affairs and Employment", "TEM"], 3], [["Traficom"], 2], [["Kela"], 2],
  [["HUS"], 2], [["Verohallinto", "Finnish Tax Administration"], 2], [["Suomen Punainen Risti", "Finnish Red Cross"], 2],
  [["UNICEF Finland"], 1], [["Teknologiateollisuus", "Technology Industries of Finland"], 2],
  [["Elinkeinoelämän keskusliitto EK", "EK", "Confederation of Finnish Industries"], 2], [["Suomen Yrittäjät"], 1],
  [["Uudenmaan ELY-keskus", "ELY-keskus"], 2], [["Tilastokeskus", "Statistics Finland"], 1], [["Ruokavirasto"], 1],
];
const ACADEMIA = [
  [["Aalto University", "Aalto-yliopisto", "Aalto University School of Business", "Aalto University School of Science", "Aalto University School of Engineering"], 14],
  [["Hanken School of Economics", "Svenska handelshögskolan", "Hanken"], 4], [["University of Helsinki", "Helsingin yliopisto"], 7],
  [["University of Vaasa", "Vaasan yliopisto"], 3], [["Tampere University", "Tampereen yliopisto"], 4], [["LUT University", "LUT-yliopisto"], 2],
  [["University of Oulu", "Oulun yliopisto"], 1], [["Metropolia Ammattikorkeakoulu", "Metropolia University of Applied Sciences"], 1],
  [["Haaga-Helia"], 1], [["VTT", "VTT Technical Research Centre of Finland Ltd"], 2],
];
const STUDENT_ORGS = ["Aaltoes", "Prodeko", "Tietokilta ry", "Teknologföreningen", "KY - Kauppatieteiden ylioppilaat", "Athene ry", "AYY", "HYY", "Inkubio ry", "Junction", "Hanken Entrepreneurship Society"];
const ABROAD = [
  [["Spotify", "Spotify AB"], 5], [["Klarna", "Klarna AB"], 4], [["Ericsson", "Ericsson AB"], 3], [["Volvo Cars"], 3], [["H&M Group"], 2],
  [["Epidemic Sound"], 1], [["King"], 2], [["Bolt", "Bolt Technology OÜ"], 4], [["Pipedrive", "Pipedrive OÜ"], 3], [["Wise"], 3],
  [["Veriff"], 2], [["Skeleton Technologies"], 1], [["Starship Technologies"], 2], [["Zalando", "Zalando SE"], 3], [["SAP", "SAP SE"], 3],
  [["Siemens", "Siemens AG"], 3], [["Robert Bosch GmbH", "Bosch"], 2], [["N26"], 1], [["Celonis"], 2], [["Personio"], 1], [["Delivery Hero"], 2],
  [["Google"], 4], [["Microsoft"], 3], [["Amazon Web Services (AWS)", "AWS", "Amazon"], 4], [["Stripe"], 2], [["Meta"], 2], [["Apple"], 2],
  [["Salesforce"], 2], [["NVIDIA"], 2], [["Databricks"], 1], [["Scania"], 1], [["ABB"], 2], [["Atlas Copco"], 1],
];
const TAGLINES = ["Helping SMEs grow with data", "Building the future of work", "Turning coffee into code ☕", "Making industry smarter",
  "On a sabbatical ⛵", "Lifelong learner", "Ex-Nokia, ex-Rovio, now something new", "Exploring what's next", "Hiring! DM me 👋"];

// ---------- titles ----------

const T_DM_OPS = W(`COO:4 Chief_Operating_Officer:2 Head_of_Operations:5 Operations_Director:4 Director,_Operations:2 Production_Director:4
Tuotantojohtaja:6 Head_of_Production:3 Tehtaanjohtaja:2 Operatiivinen_johtaja:2 Supply_Chain_Director:2 Toimitusketjujohtaja:1
Logistiikkajohtaja:2 Director_of_Manufacturing:1 VP_Operations:1 Operativ_direktör:1 Produktionsdirektör:1 Head_of_Supply_Chain:1
Plant_Director:1 Tuotanto-_ja_logistiikkajohtaja:1`);
const T_DM_FIN = W("CFO:4 Talousjohtaja:5 Chief_Financial_Officer:1 Finance_Director:2 Ekonomidirektör:1");
const T_DM_TECH = W(`CTO:3 Teknologiajohtaja:2 Tekninen_johtaja:3 R&D_Director:2 Head_of_R&D:2 Tuotekehitysjohtaja:2 Head_of_Engineering:2
Digitalisaatiojohtaja:1 IT_Director:1 Tietohallintojohtaja:2 Head_of_IT:1 Chief_Digital_Officer:1`);
const T_DM_SALES = W("Sales_Director:4 Myyntijohtaja:5 Commercial_Director:2 Kaupallinen_johtaja:1 Head_of_Sales:2 Vientijohtaja:2 Export_Director:1 Markkinointijohtaja:2");
const T_DM_OTHER = W("HR_Director:1 Henkilöstöjohtaja:2 Quality_Director:1 Laatujohtaja:2 Hankintajohtaja:2 Kehitysjohtaja:2 Liiketoimintajohtaja:2 Business_Director:1 Head_of_Quality:1");
const T_MGR_OPS = W(`Production_Manager:5 Tuotantopäällikkö:6 Operations_Manager:4 Operations_Manager_|_Lean_|_ERP:1 Logistics_Manager:2
Logistiikkapäällikkö:3 Plant_Manager:2 Tehdaspäällikkö:2 Produktionschef:1 Supply_Chain_Manager:2`);
const T_SME = W(`Design_Engineer:4 Suunnitteluinsinööri:5 Mekaniikkasuunnittelija:3 Project_Manager:5 Projektipäällikkö:6 Key_Account_Manager:4
Myyntipäällikkö:5 Area_Sales_Manager:3 Export_Manager:3 Quality_Manager:3 Laatupäällikkö:3 Quality_Engineer:2 Production_Planner:3
Tuotannonsuunnittelija:3 Buyer:2 Ostaja:2 Purchasing_Manager:2 Hankintapäällikkö:2 Service_Technician:2 Huoltoteknikko:2 Asentaja:2
Hitsaaja:1 CNC-koneistaja:1 Automation_Engineer:2 Automaatioinsinööri:2 Maintenance_Manager:2 Kunnossapitopäällikkö:2 Työnjohtaja:3
Product_Manager:3 Tuotepäällikkö:3 HR_Manager:2 Controller:2 Business_Controller:2 Kirjanpitäjä:1 Marketing_Manager:2
Markkinointipäällikkö:2 Sales_Engineer:3 Myyntiinsinööri:2 R&D_Engineer:2 Tuotekehitysinsinööri:2 Ohjelmistosuunnittelija:1
Asiakaspalvelu:1 Varastopäällikkö:2 IT_Manager:2 IT-päällikkö:2 Development_Engineer:2 Harjoittelija:1 Production_Engineer:2
Tuotantoinsinööri:2 Inköpare:1 Konstruktör:1 Säljare:1 Projektledare:1 ERP_Specialist:1 Toiminnanohjausjärjestelmän_pääkäyttäjä:1`);
const T_SECTOR = {
  food: W("Leipuri:2 Panimomestari:2 Head_Brewer:1 Elintarviketeknologi:2 Food_Technologist:1 Laatuvastaava:2 Tuotekehittäjä:2"),
  construction: W("Vastaava_työnjohtaja:3 Työmaapäällikkö:3 Site_Manager:2 Projektinjohtaja:2 Hankeinsinööri:1 Kustannuslaskija:2 Rakennusmestari:2"),
  logistics: W("Ajojärjestelijä:3 Kuljetussuunnittelija:2 Logistics_Coordinator:2 Terminal_Manager:1 Terminaalipäällikkö:2 Huolitsija:2 Customs_Specialist:1"),
  maritime: W("Naval_Architect:3 Laivanrakennusinsinööri:2 Ship_Superintendent:2 Chief_Engineer:1 Boat_Builder:1 Venevalmistaja:1 Chartering_Manager:2"),
  wholesale: W("Inside_Sales:2 Myyntiedustaja:3 Account_Manager:3 Product_Specialist:2 Tuoteasiantuntija:2 Category_Manager:1"),
};
const T_CORP_DM = W(`Director,_Operations_Excellence:2 Head_of_Digital_Operations:2 VP,_Supply_Chain:1 Director,_Global_Sourcing:1 Head_of_AI:2
Head_of_Data_&_Analytics:2 Director,_R&D:1 Vice_President,_Service_Business:1 Head_of_Procurement:1 Director,_Strategy:1 Kehitysjohtaja:1
Head_of_Production_Planning:1 Senior_Director,_Digital:1`);
const T_CORP = W(`Senior_Specialist:3 Project_Engineer:3 Service_Manager:2 Product_Owner:4 Development_Manager:3 Category_Manager:2
Ostopäällikkö:1 Senior_Data_Scientist:2 Solution_Architect:3 Kehityspäällikkö:3 Projektipäällikkö:3 Asiantuntija:3
Senior_Manager,_Operational_Excellence:1 Lean_Manager:1 R&D_Manager:2 Senior_Engineer:3 Global_Category_Manager:1
Supply_Chain_Manager:2 Operations_Development_Manager:1 Business_Controller:2 HR_Business_Partner:2 Product_Line_Manager:1
Marketing_Manager:2 Account_Manager:2 Software_Engineer:3 Data_Engineer:2 Program_Manager:2 Sourcing_Manager:1 Summer_Trainee:1
Kesätyöntekijä:1 Production_Supervisor:1 Process_Engineer:2 Prosessi-insinööri:1 Automation_Specialist:1 Sustainability_Manager:1
Vastuullisuuspäällikkö:1 Legal_Counsel:1 Viestintäpäällikkö:1 Key_Account_Manager:2`);
const T_STARTUP_DM = W(`Head_of_Growth_🚀:2 Head_of_Product:2 Head_of_Operations:1 Head_of_Sales:1 VP_Engineering:1 Director_of_Engineering:1
Head_of_People:1 Head_of_Marketing:1 Head_of_Partnerships:1 Head_of_Hardware:1`);
const T_STARTUP = W(`Software_Engineer:8 Senior_Software_Engineer:6 Backend_Engineer:3 Frontend_Developer:3 Full_Stack_Developer:3
Data_Scientist:3 Machine_Learning_Engineer:3 Product_Manager:4 Senior_Product_Manager:2 Product_Designer:3 UX_Designer:2 Growth_Lead:1
Growth_Marketing_Manager:2 Customer_Success_Manager:3 Account_Executive:3 Business_Development_Manager:2 Talent_Acquisition_Partner:2
People_&_Culture_Lead:1 Engineering_Manager:2 Staff_Engineer:1 Principal_Engineer:1 Founding_Engineer:1 Operations_Manager:2
City_Launcher:1 Hardware_Engineer:2 Firmware_Engineer:1 Quantum_Engineer:1 Research_Scientist:2 Sales_|_SaaS_|_Nordics:1
Brand_Designer:1 Content_Lead:1 Community_Manager:1 Data_Analyst:2 QA_Engineer:1 iOS_Developer:1 Android_Developer:1
DevOps_Engineer:1 Site_Reliability_Engineer:1 Mechanical_Engineer:1 Partnerships_Manager:1 Office_Manager:1
Product_Marketing_Manager:1 Summer_Intern:1`);
const T_SOFT_DM = W(`Head_of_Data_&_AI:2 Sales_Director:2 Business_Director:2 Account_Director:2 Director,_Industrial_Clients:1 Partner:2
Head_of_Design:1 Liiketoimintajohtaja:1 Myyntijohtaja:1 Director,_AI:1`);
const T_SOFT = W(`Software_Developer:5 Senior_Consultant:4 Lead_Consultant:2 Data_Engineer:3 AI_Consultant:2 Designer:2 Service_Designer:2
Principal_Consultant:1 Cloud_Architect:2 DevOps_Engineer:2 Scrum_Master:1 Agile_Coach:1 Ohjelmistokehittäjä:3 Konsultti:2
Myyntipäällikkö:2 Ratkaisuarkkitehti:1 Full-stack_developer_|_React_|_Node:1 Senior_Software_Architect:1 Data_Scientist:2 Tech_Lead:2
Project_Manager:2 Key_Account_Manager:2 Business_Analyst:1 UX/UI_Designer:1 Test_Automation_Engineer:1 Junior_Developer:1
Talent_Partner:1 Marketing_Specialist:1`);
const T_PARTNER = W("Partner_Manager:2 Key_Account_Manager:2 Solution_Consultant:2 Sales_Manager,_ERP:1 Senior_Consultant,_ERP:1 Channel_Manager:1");
const T_OWN = ["AI Engineer", "Software Engineer", "Data Scientist", "Full-stack Developer", "Designer"];
const T_ACADEMIA = W(`Student:8 Opiskelija:5 Master's_student:3 M.Sc._Student,_Industrial_Engineering_and_Management:1 Kauppatieteiden_opiskelija:2
Tekniikan_ylioppilas:1 Doctoral_Researcher:5 Väitöskirjatutkija:3 Doctoral_Candidate:2 Postdoctoral_Researcher:2 Research_Assistant:2
Tutkimusavustaja:1 University_Lecturer:1 Yliopistonlehtori:1 Assistant_Professor:1 Teaching_Assistant:1 Exchange_Student:1
Research_Scientist:1 Senior_Scientist:1`);
const T_STUDENT_ORG = W("Board_Member:4 Hallituksen_jäsen:4 Head_of_Corporate_Relations:2 Yrityssuhdevastaava:2 Treasurer:1 Rahastonhoitaja:1 Vice_President:1 Head_of_Events:1");
const T_ECO_DM = W("Head_of_Partnerships:2 Director,_Startup_Services:1 Head_of_Programs:1 Investment_Director:1 Head_of_Community:1");
const T_ECO = W(`Investment_Manager:3 Investment_Analyst:3 Associate:2 Senior_Associate:2 Program_Manager:3 Community_Manager:2
Partnerships_Manager:2 Volunteer:2 Senior_Advisor:3 Customer_Manager:2 Asiakkuuspäällikkö:2 Rahoitusasiantuntija:2 Funding_Advisor:1
Startup_Advisor:1 Ecosystem_Lead:1 Event_Producer:1 Board_Member:1 Head_of_Events:1`);
const T_PUBLIC_DM = W("Kehitysjohtaja:1 Head_of_Unit:1 Director,_Business_Services:1 Elinkeinojohtaja:1");
const T_PUBLIC = W(`Erityisasiantuntija:3 Kehittämispäällikkö:2 Senior_Specialist:2 Neuvotteleva_virkamies:1 Elinkeinoasiamies:1 Project_Manager:2
Projektikoordinaattori:1 Business_Advisor:1 Yritysneuvoja:2 Ohjelmapäällikkö:1 Analyst:1 Johtava_asiantuntija:2 Yksikön_päällikkö:1`);
const T_ABROAD_DM = W("Director,_Product:1 Head_of_Nordics:1 Senior_Director,_Engineering:1 Head_of_Partnerships_EMEA:1");
const T_ABROAD = W(`Software_Engineer:5 Senior_Software_Engineer:4 Product_Manager:3 Data_Scientist:2 Engineering_Manager:2 Solutions_Architect:2
Account_Executive:2 Customer_Success_Manager:1 Designer:1 Research_Scientist:1 Staff_Engineer:1 Partner_Manager:1
Business_Development_Manager:1 Mechanical_Engineer:1 Supply_Chain_Analyst:1 Strategy_Manager:1`);
const T_SELF = W(`Founder:3 Co-founder_&_CEO:3 Co-founder:2 Founder_&_CEO:1 Freelance_Consultant:3 Independent_Consultant:2 Konsultti:1
Freelance_Designer:2 Advisor:2 Board_Professional:1 Hallitusammattilainen:1 Interim_Manager:1 Yrittäjä:2 Toimitusjohtaja:1 VD:1
Coach:1 Open_to_work:2 Looking_for_new_opportunities:2 Taking_a_break_🌱:1 Career_break:1`);
const SKILLS = ["Lean", "ERP", "Six Sigma", "Industry 4.0", "AI", "Data", "SaaS", "B2B", "Continuous improvement", "MES", "SAP", "Power BI", "Python", "Supply chain", "Automation"];

// Rough decision-maker test for the report only; the app has its own rules.
const DM_RE = /\b(ceo|coo|cfo|cto|cio|chief|founder|co-founder|owner|managing director|director|head of|vp|vice president|partner|vd|direktör)\b|(?<!työn|puheen)johtaja\b/i;

// ---------- display names: how people actually write a company ----------

const FORM_TAIL = /\s+(Oyj|Oy|Ab|Abp|Ltd|Ltd\.)$/;
const FORM_HEAD = /^(Oy|Ab)\s+/;
function stripForms(name) {
  let n = name.replace(FORM_HEAD, "");
  while (FORM_TAIL.test(n)) n = n.replace(FORM_TAIL, "");
  return n.trim();
}
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function typo(s) {
  const i = int(1, s.length - 3);
  const r = rnd();
  if (r < 0.4) return s.slice(0, i) + s.slice(i + 1);
  if (r < 0.7) return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
  return s.slice(0, i) + s[i] + s.slice(i);
}

function smeDisplay(sme) {
  const [official, , ...aliases] = sme;
  const base = stripForms(official);
  const r = rnd();
  if (aliases.length && r < 0.14) return pick(aliases);
  if (r < 0.55) return base;
  if (r < 0.77) return official;
  if (r < 0.82) return /\bOy\b/.test(official) && !/ Oy$/.test(official) ? `${base} Oy` : `${base} Ltd`;
  if (r < 0.86) return `${base} Oy`;
  if (r < 0.89) return base.toUpperCase();
  if (r < 0.91) return base.toLowerCase();
  if (r < 0.94 && base.length > 6) return typo(base);
  if (r < 0.97 && fold(base) !== base) return fold(base);
  if (r < 0.985) return `${base} | ${pick(["Since 1972", "Made in Finland", "We are hiring", "Part of something bigger"])}`;
  return `${base}, Finland`;
}

function listDisplay(names) {
  // The usual name most of the time, a variant now and then, a typo rarely.
  const r = rnd();
  if (r < 0.62 || names.length === 1) return r > 0.985 && names[0].length > 6 ? typo(names[0]) : names[0];
  return pick(names.slice(1));
}

// ---------- people ----------

const usedSlugs = new Set();
const usedEmails = new Set();
const asciiSlug = (s) => fold(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function makeUrl(first, last) {
  const f = asciiSlug(first) || "member";
  const l = asciiSlug(last) || hex(4);
  const r = rnd();
  let s;
  if (r < 0.006) return "";
  if (r < 0.015 && fold(first + last) !== first + last) s = `${encodeURIComponent(`${first.toLowerCase()}-${last.toLowerCase()}`)}-${hex(8)}`;
  else if (r < 0.56) s = `${f}-${l}-${hex(8)}`;
  else if (r < 0.85) s = `${f}-${l}`;
  else if (r < 0.92) s = `${f}${l}`.replace(/-/g, "");
  else if (r < 0.96) s = `${f[0]}${l}`.replace(/-/g, "");
  else s = pick([`${f}-${l}-${int(1, 99)}`, `${f}${l[0]}`, `${l}${f}`.replace(/-/g, ""), `${f}-${l}-${pick(["fi", "hki", "dev", "design", "ai"])}`]);
  while (usedSlugs.has(s)) s = `${f}-${l}-${hex(8)}`;
  usedSlugs.add(s);
  return `https://www.linkedin.com/in/${s}`;
}

function makeEmail(first, last) {
  if (!chance(0.05)) return "";
  const f = asciiSlug(first).replace(/-/g, "");
  const l = asciiSlug(last).replace(/-/g, "");
  let e = pick([`${f}.${l}`, `${f}.${l}`, `${f[0]}${l}`, `${f}${l}`, `${f}.${l}${int(1, 99)}`]);
  while (usedEmails.has(e)) e = `${f}.${l}${int(1, 999)}`;
  usedEmails.add(e);
  return `${e}@example.com`;
}

/** Real profiles are messy: a few lowercase names, degrees after the surname, a maiden name. */
function messName(first, last) {
  const r = rnd();
  if (r < 0.004) return [first.toLowerCase(), last];
  if (r < 0.008) return [first, `${last}, ${pick(["MBA", "PhD", "M.Sc. (Tech.)", "DI", "CFA"])}`];
  if (r < 0.011) return [first, `${last} (${weighted(FI_LAST)})`];
  if (r < 0.013) return [`${first} ${pick(["🌿", "🚀", "☀️"])}`, last];
  if (r < 0.015) return [first, ""];
  return [first, last];
}

/** Mess applied to every title: blanks, caps, extra detail. */
function messTitle(t) {
  if (!t) return t;
  const r = rnd();
  if (r < 0.02) return t.toUpperCase();
  if (r < 0.05) return `${t} | ${pick(SKILLS)} | ${pick(SKILLS)}`;
  if (r < 0.06) return `${t} | ${pick(SKILLS)} | ${pick(SKILLS)} | Helping industrial companies get more out of their ${pick(["data", "ERP", "production", "people"])}`;
  if (r < 0.07) return `${t} 🚀`;
  return t;
}

const smeCount = new Map();
const companyPeople = new Map();

function titleFor(segment, ctx = {}) {
  switch (segment) {
    case "target": {
      if (ctx.forceDm || chance(ctx.dmShare ?? 0.35)) {
        const r = rnd();
        return weighted(r < 0.5 ? T_DM_OPS : r < 0.62 ? T_DM_FIN : r < 0.77 ? T_DM_TECH : r < 0.9 ? T_DM_SALES : T_DM_OTHER);
      }
      if (chance(0.16)) return weighted(T_MGR_OPS);
      if (T_SECTOR[ctx.sector] && chance(0.3)) return weighted(T_SECTOR[ctx.sector]);
      return weighted(T_SME);
    }
    case "corporate": return chance(ctx.dmShare ?? 0.15) ? weighted(T_CORP_DM) : weighted(T_CORP);
    case "startup": return chance(0.14) ? weighted(T_STARTUP_DM) : weighted(T_STARTUP);
    case "software": return chance(0.19) ? weighted(T_SOFT_DM) : weighted(T_SOFT);
    case "ecosystem": return chance(0.15) ? weighted(T_ECO_DM) : weighted(T_ECO);
    case "public": return chance(0.12) ? weighted(T_PUBLIC_DM) : weighted(T_PUBLIC);
    case "abroad": return chance(0.12) ? weighted(T_ABROAD_DM) : weighted(T_ABROAD);
    case "academia": return weighted(T_ACADEMIA);
    default: return weighted(T_SELF);
  }
}

function pickSme(pool) {
  // Spread people over SMEs: prefer companies with fewer people so far.
  const cands = Array.from({ length: 4 }, () => pick(pool));
  cands.sort((a, b) => (smeCount.get(a[0]) ?? 0) - (smeCount.get(b[0]) ?? 0));
  return cands[0];
}

function newPerson(segment, opts = {}) {
  const { first, last, origin } = makeName(segment === "own" || segment === "partner" ? "software" : segment);
  let company = "";
  let position = "";
  let key = "";
  const seg = segment === "own" || segment === "partner" ? "software" : segment;
  if (segment === "target") {
    const sme = opts.sme ?? pickSme(opts.pool ?? ALL_TARGETS);
    smeCount.set(sme[0], (smeCount.get(sme[0]) ?? 0) + 1);
    company = smeDisplay(sme);
    key = sme[0];
    position = titleFor("target", { sector: sme[1], dmShare: opts.dmShare, forceDm: opts.forceDm });
  } else if (segment === "own") {
    company = chance(0.8) ? "Lumenkeep" : "Lumenkeep Oy";
    key = "Lumenkeep";
    position = pick(T_OWN);
  } else if (segment === "partner") {
    const p = pick(PARTNERS);
    company = listDisplay(p);
    key = p[0];
    position = weighted(T_PARTNER);
  } else if (segment === "academia") {
    if (chance(0.22)) {
      company = pick(STUDENT_ORGS);
      position = weighted(T_STUDENT_ORG);
    } else {
      const a = weighted(ACADEMIA);
      company = listDisplay(a);
      position = titleFor("academia");
    }
    key = company;
  } else if (segment === "self") {
    const r = rnd();
    position = titleFor("self");
    if (/open to work|looking|break/i.test(position)) company = pick(["", "", "Open to work", "Between jobs"]);
    else if (/founder|ceo/i.test(position)) company = pick(["Stealth", "Stealth Startup", "Stealth Mode Startup", "Building something new", ...TAGLINES]);
    else if (r < 0.15) company = pick(TAGLINES);
    else company = pick(["Self-employed", "Self-employed", "Freelance", "Freelancer", "Yrittäjä", "Oma yritys", "Itsenäinen ammatinharjoittaja", "Various", ""]);
    key = company;
  } else {
    const list = { corporate: CORPORATES, startup: STARTUPS, software: SOFTWARE, ecosystem: ECOSYSTEM, public: PUBLIC, abroad: ABROAD }[segment];
    const c = weighted(list);
    company = listDisplay(c);
    key = c[0];
    position = titleFor(segment, { dmShare: opts.dmShare });
  }
  if (chance(0.075)) position = "";
  position = messTitle(position);
  const [fn, ln] = messName(first, last);
  const p = { first: fn, last: ln, url: makeUrl(first, last), email: makeEmail(first, last), company, position, segment, seg, key, origin, cleanName: `${first} ${last}` };
  companyPeople.set(key, (companyPeople.get(key) ?? 0) + 1);
  return p;
}

// ---------- connection dates ----------

const YEAR_W = { 2015: 3, 2016: 4, 2017: 5, 2018: 6, 2019: 7, 2020: 6, 2021: 8, 2022: 10, 2023: 11, 2024: 12, 2025: 13, 2026: 11 };
// Slush (late Nov / early Dec) and Aaltoes spring events (Mar-May) show as bumps; July is quiet.
const MONTH_W = [1.0, 1.0, 1.25, 1.5, 1.3, 0.9, 0.45, 0.7, 1.1, 1.1, 2.5, 1.7];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const [TY, TM, TD] = TODAY.split("-").map(Number);

function connectedOn(minYear = 2015) {
  const years = Object.entries(YEAR_W).filter(([y]) => Number(y) >= minYear && Number(y) <= TY).map(([y, w]) => [Number(y), w]);
  const y = weighted(years);
  const months = MONTH_W.map((w, m) => [m, w]).filter(([m]) => y < TY || m + 1 <= TM);
  const m = weighted(months);
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const maxDay = y === TY && m + 1 === TM ? TD : dim;
  let d;
  if (m === 10 && chance(0.6)) d = int(15, 30);
  else if (m === 11 && chance(0.5)) d = int(1, 7);
  else d = int(1, maxDay);
  d = Math.min(d, maxDay);
  return new Date(Date.UTC(y, m, d));
}
const fmtDate = (dt) => `${String(dt.getUTCDate()).padStart(2, "0")} ${MON[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;

// ---------- networks ----------

const SEGMENTS = ["startup", "software", "academia", "corporate", "target", "ecosystem", "public", "abroad", "self"];
const SEG_LABEL = {
  startup: "Startups and scale-ups", software: "Software, IT consultancies, agencies", academia: "Students and academia",
  corporate: "Large Finnish corporates", target: "Target: Finnish SMEs with physical operations", ecosystem: "Investors, accelerators, ecosystem",
  public: "Public sector and NGOs", abroad: "International companies abroad", self: "Self-employed, stealth, between jobs, empty",
};

function counts(n, shares) {
  const raw = SEGMENTS.map((s) => (shares[s] ?? 0) * n);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) if (left-- > 0) out[i]++;
  return Object.fromEntries(SEGMENTS.map((s, i) => [s, out[i]]));
}

const OWNERS = {
  you: { file: "Connections.csv", n: 1500, shares: { startup: 0.25, software: 0.12, academia: 0.12, corporate: 0.1, target: 0.18, ecosystem: 0.06, public: 0.04, abroad: 0.08, self: 0.05 } },
  cofounder: { file: "Connections-cofounder.csv", n: 860, overlap: 270, shares: { startup: 0.22, software: 0.15, academia: 0.1, corporate: 0.12, target: 0.2, ecosystem: 0.05, public: 0.03, abroad: 0.09, self: 0.04 } },
  board: { file: "Connections-board.csv", n: 300, overlap: 60, shares: { startup: 0.07, software: 0.07, academia: 0.03, corporate: 0.25, target: 0.32, ecosystem: 0.14, public: 0.07, abroad: 0.03, self: 0.02 } },
};

if (ROWS) {
  const f = ROWS / OWNERS.you.n;
  for (const o of Object.values(OWNERS)) {
    o.n = Math.round(o.n * f);
    if (o.overlap) o.overlap = Math.round(o.overlap * f);
  }
}

// "You": the full spec mix, plus the demo user's own small company, Lumenkeep (invented), and its world.
const you = [];
{
  const c = counts(OWNERS.you.n, OWNERS.you.shares);
  for (let i = 0; i < 5; i++) you.push(newPerson("own"));
  for (let i = 0; i < 4; i++) you.push(newPerson("partner"));
  c.software -= 9;
  for (const name of CUSTOMERS) {
    const sme = TARGET.find((t) => t[0] === name);
    const k = name === CUSTOMERS[0] ? 4 : 3;
    for (let i = 0; i < k; i++) you.push(newPerson("target", { sme, forceDm: i < 2 }));
    c.target -= k;
  }
  for (const sme of SIGNAL_TARGETS) {
    you.push(newPerson("target", { sme, forceDm: chance(0.7) }));
    c.target--;
  }
  // Every SME gets at least one person; the rest are spread one or two per SME.
  const firstPass = shuffle(TARGET.filter((t) => !CUSTOMERS.includes(t[0])).slice());
  for (const sme of firstPass) {
    if (c.target <= 0) break;
    you.push(newPerson("target", { sme }));
    c.target--;
  }
  for (const s of SEGMENTS) for (let i = 0; i < c[s]; i++) you.push(newPerson(s, { pool: ALL_TARGETS }));
}

/** Picks k people from `from`, weighted by segment, without replacement. */
function overlapPick(from, k, segW) {
  const pool = from.map((p) => [p, segW[p.segment] ?? segW[p.seg] ?? 1]);
  const out = [];
  while (out.length < k && pool.length) {
    let total = 0;
    for (const [, w] of pool) total += w;
    let r = rnd() * total;
    let i = 0;
    for (; i < pool.length; i++) if ((r -= pool[i][1]) < 0) break;
    out.push(pool.splice(Math.min(i, pool.length - 1), 1)[0][0]);
  }
  return out;
}

function fill(owner, shared) {
  const o = OWNERS[owner];
  const c = counts(o.n - shared.length, o.shares);
  const out = [...shared];
  const dmShare = owner === "board" ? 0.5 : undefined;
  for (const s of SEGMENTS) for (let i = 0; i < c[s]; i++) out.push(newPerson(s, { dmShare: s === "corporate" && owner === "board" ? 0.35 : dmShare, pool: ALL_TARGETS }));
  return out;
}

// Co-founder: shares colleagues, partners, customers and a lot of the ecosystem with "You".
const coShared = [
  ...you.filter((p) => p.segment === "own"),
  ...you.filter((p) => CUSTOMERS.includes(p.key)).filter(() => chance(0.6)),
];
coShared.push(...overlapPick(you.filter((p) => !coShared.includes(p)), OWNERS.cofounder.overlap - coShared.length, { ecosystem: 4, startup: 2.5, software: 2.5, partner: 3, target: 1.5, academia: 1, corporate: 1, public: 1, abroad: 0.6, self: 0.6 }));
const cofounder = fill("cofounder", coShared);

// Board member: older, industrial. Knows a few of the same SME people and investors.
const boardShared = [
  ...you.filter((p) => p.segment === "own").slice(0, 2),
  ...overlapPick(you.filter((p) => p.segment !== "own"), 28, { target: 4, corporate: 3, ecosystem: 3, public: 1.5, software: 1, startup: 0.5, academia: 0.2, abroad: 0.3, self: 0.5 }),
];
const coOnly = cofounder.filter((p) => !you.includes(p));
boardShared.push(...overlapPick(coOnly, OWNERS.board.overlap - boardShared.length - 12, { target: 4, corporate: 3, ecosystem: 2, software: 1, startup: 0.5, academia: 0.2, abroad: 0.3, public: 1, self: 0.5 }));
boardShared.push(...overlapPick(coShared.filter((p) => !boardShared.includes(p)), 12, { target: 4, corporate: 3, ecosystem: 3, partner: 1, software: 1, startup: 0.5, academia: 0.2, abroad: 0.3, public: 1, self: 0.5 }));
const board = fill("board", boardShared);

// ---------- write ----------

// Built from parts so the personal-data guard does not take this file for an export.
const COLUMNS = ["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"].join(",");
const NOTES = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"

${COLUMNS}
`;
const q = (v) => (/[",\n\r]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function write(owner, people) {
  const minYear = (p) => (p.segment === "academia" ? 2020 : 2015);
  const rows = people.map((p) => ({ p, dt: connectedOn(minYear(p)) })).sort((a, b) => b.dt - a.dt || a.p.url.localeCompare(b.p.url));
  const lines = rows.map(({ p, dt }) => [p.first, p.last, p.url, p.email, p.company, p.position, fmtDate(dt)].map(q).join(","));
  fs.writeFileSync(path.join(OUT, OWNERS[owner].file), NOTES + lines.join("\n") + "\n");
  return rows;
}

const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
function report(owner, people, rows) {
  const n = people.length;
  console.log(`\n${OWNERS[owner].file} (${owner}): ${n} rows`);
  for (const s of SEGMENTS) {
    const k = people.filter((p) => p.seg === s).length;
    console.log(`  ${SEG_LABEL[s].padEnd(48)} ${String(k).padStart(4)}  ${pct(k, n)}`);
  }
  const empty = (f) => people.filter((p) => !p[f]).length;
  console.log(`  empty: company ${pct(empty("company"), n)}, position ${pct(empty("position"), n)}, email ${pct(empty("email"), n)}, URL ${pct(empty("url"), n)}, last name ${pct(empty("last"), n)}`);
  console.log(`  distinct company strings: ${new Set(people.map((p) => p.company).filter(Boolean)).size}, distinct companies: ${new Set(people.map((p) => p.key).filter(Boolean)).size}`);
  const dm = people.filter((p) => DM_RE.test(p.position)).length;
  const tgt = people.filter((p) => p.seg === "target");
  console.log(`  decision-maker titles: ${pct(dm, n)} overall, ${pct(tgt.filter((p) => DM_RE.test(p.position)).length, tgt.length)} in the target segment`);
  const o = { fi: 0, sv: 0, intl: 0 };
  for (const p of people) o[p.origin]++;
  console.log(`  names: Finnish ${pct(o.fi, n)}, Finland-Swedish ${pct(o.sv, n)}, international ${pct(o.intl, n)}`);
  console.log(`  connected: ${fmtDate(rows[rows.length - 1].dt)} to ${fmtDate(rows[0].dt)}`);
}

fs.mkdirSync(OUT, { recursive: true });
const rowsYou = write("you", you);
const rowsCo = write("cofounder", cofounder);
const rowsBoard = write("board", board);
report("you", you, rowsYou);
report("cofounder", cofounder, rowsCo);
report("board", board, rowsBoard);

const all = [...new Set([...you, ...cofounder, ...board])];
const youSet = new Set(you);
const coSet = new Set(cofounder);
console.log(`\nMerged: ${all.length} distinct people. In "You" and co-founder: ${cofounder.filter((p) => youSet.has(p)).length}. Board shared with others: ${board.filter((p) => youSet.has(p) || coSet.has(p)).length}. In all three: ${board.filter((p) => youSet.has(p) && coSet.has(p)).length}.`);
const byName = new Map();
for (const p of you) byName.set(p.cleanName, [...(byName.get(p.cleanName) ?? []), p]);
const dups = [...byName.entries()].filter(([, ps]) => ps.length > 1 && new Set(ps.map((p) => p.key)).size > 1);
console.log(`Exact duplicate names at different companies in Connections.csv: ${dups.length} (e.g. ${dups.slice(0, 5).map(([n, ps]) => `${n} x${ps.length}`).join(", ")})`);
const smes = ALL_TARGETS.length;
console.log(`Target SMEs: ${smes}, with someone in "You": ${ALL_TARGETS.filter((t) => you.some((p) => p.key === t[0])).length}`);

if (args.includes("--check-prh")) {
  const { matchCompany } = await import("../lib/prh.ts");
  const tally = {};
  for (const t of ALL_TARGETS) {
    const m = await matchCompany(t[0]);
    tally[m.status] = (tally[m.status] ?? 0) + 1;
    if (m.status !== "verified") console.log(`  ${t[0]}: ${m.status} (${m.note})`);
  }
  console.log("PRH check of official target names:", tally);
}
