const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function localToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
let today = localToday();
function refreshToday() {
  today = localToday();
  return today;
}
let selectedStockProductId = "";
let editingOrderId = "";
let sourceEntryForOrderId = "";
let sourceEntryDistributionEnabled = false;
let sourceEntryGroupForOrderIds = [];
let saleExtraItemDrafts = [];
let linkedInvoiceOrderIds = [];
let linkedInvoiceEntryId = "";
let editingProductId = "";
let editingCustomerDocument = "";
let activeCustomerSearch = "";
let activeViewId = "dashboard";
let customerImportMode = "merge";
let customersTextNormalized = false;
let activeFreightRateType = "entrega";
let cloudDb = null;
let cloudDocRef = null;
let cloudCollectionRef = null;
let cloudDocumentId = "cimento-e-cia";
let cloudChunkCount = 0;
let cloudRevision = "";
let cloudReady = false;
let cloudLoading = false;
let cloudSaveTimer = null;
let cloudUnsubscribe = null;
let applyingCloudState = false;
let cloudPendingLocalChanges = false;
let firebaseAuth = null;
let firebaseReady = false;
let firebaseLoginInProgress = false;
let currentSessionUser = null;
let lastCloudError = "";
const stockLocations = ["Divinopolis", "Arcos"];
const cloudChunkSize = 120000;

function makeEmptyLocations() {
  return stockLocations.reduce((locations, location) => {
    locations[location] = 0;
    return locations;
  }, {});
}

const users = [
  { user: "ana", name: "Ana Luisa", role: "Gestao" },
  { user: "camila", name: "Camila", role: "Vendas" },
  { user: "tiago", name: "Tiago", role: "Estoque" },
  { user: "laiz", name: "Laiz", role: "Financeiro" },
  { user: "juliana", name: "Juliana", role: "Logistica" },
  { user: "miriam", name: "Miriam", role: "Gerencia" }
];

const permissionModules = [
  { id: "dashboard", label: "Painel" },
  { id: "estoque", label: "Estoque" },
  { id: "clientes", label: "Clientes" },
  { id: "produtos", label: "Produtos" },
  { id: "pedidos", label: "Pedidos" },
  { id: "logistica", label: "Logistica" },
  { id: "fretes", label: "Fretes" },
  { id: "financeiro", label: "Financeiro" },
  { id: "boletos", label: "Boletos Omie" },
  { id: "relatorios", label: "Relatorios" },
  { id: "notas", label: "Notas fiscais" },
  { id: "configuracoes", label: "Configurações" }
];

function defaultPermissions() {
  return permissionModules.reduce((permissions, module) => {
    permissions[module.id] = true;
    return permissions;
  }, {});
}

function serializeUsersConfig() {
  return users.map((item) => ({
    user: item.user,
    name: item.name,
    permissions: item.permissions || defaultPermissions()
  }));
}

function applyUsersConfig(savedUsers) {
  if (!Array.isArray(savedUsers)) return;
  users.forEach((user) => {
    const saved = savedUsers.find((item) => item.user === user.user);
    if (saved?.name) user.name = saved.name;
    user.permissions = { ...defaultPermissions(), ...(saved?.permissions || {}) };
  });
}

function syncUsersConfigToState() {
  if (typeof state === "undefined") return;
  state.usersConfig = serializeUsersConfig();
}

function safeLocalJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Dados locais invalidos em ${key}:`, error);
    try {
      const backupKey = `${key}Backup${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
      localStorage.setItem(backupKey, localStorage.getItem(key) || "");
      localStorage.removeItem(key);
    } catch (backupError) {
      console.error("Nao foi possivel criar backup do dado invalido:", backupError);
    }
    return fallback;
  }
}

const savedUsers = safeLocalJson("cimentoGestorUsers", null);
if (savedUsers) {
  applyUsersConfig(savedUsers);
}
users.forEach((user) => {
  user.permissions = { ...defaultPermissions(), ...(user.permissions || {}) };
});

const defaultPaymentMethods = [
  "Boleto",
  "Pix",
  "Cartao",
  "Cartao credito",
  "Cartao debito",
  "Dinheiro",
  "Cheque",
  "Deposito",
  "Transferencia",
  "Permuta"
];
const defaultPaymentTerms = ["7", "14", "15", "21", "28", "30", "35", "21/28", "21/28/35", "28/35", "30/45", "30/60"];

const state = {
  stock: [],
  orders: [],
  deletedOrders: [],
  deletedProductKeys: [],
  customers: [],
  receivables: [],
  usersConfig: [],
  salespeople: ["Edmilson", "Edson", "Balcao", "Vendas externas", "Douglas"],
  drivers: [],
  sellerCities: [],
  paymentRules: [],
  paymentTerms: [],
  freightRates: [],
  freightTypes: {},
  dashboardLockOverrides: {},
  stockLockDate: "",
  manualStockSequence: 0,
  reusableOrderIds: [],
  paymentMethods: [...defaultPaymentMethods],
  financialAccounts: [
    { id: "caixa", name: "Caixa", balance: 0 },
    { id: "banco", name: "Banco", balance: 0 },
    { id: "pix", name: "Pix", balance: 0 }
  ],
  notes: [],
  stockEntries: [],
  movements: []
};
const emptyStateTemplate = JSON.parse(JSON.stringify(state));
const financePageSize = 50;
let financeCurrentPage = 1;

const customerBatchImportVersion = "clientes-7-planilhas-2026-06-23-v2";
const freightRatesImportVersion = "fretes-entrega-retorno-2026-06-22-v1";
const initialDeliveryFreightRates = [
  ["Abaete",3.60],["Areado",4.86],["Aguanil",3.10],["Albert Isaacson",3.90],["Alfenas",5.00],
  ["Alpinopolis",4.00],["Alterosa",5.10],["Araujo",3.26],["Arceburgo",5.40],["Arcos",0.60],
  ["Bambui",2.04],["Biquinhas",4.55],["Boa Esperanca",3.40],["Bom Despacho",2.47],["Bom Jesus da Penha",4.00],
  ["Bom Sucesso",3.90],["Bonfim",4.20],["Boticao",3.10],["Camacho",3.30],["Campo Belo",2.47],
  ["Campo do Meio",4.00],["Campos Altos",3.10],["Campos Gerais",4.00],["Cana Verde",3.10],["Candeias",2.47],
  ["Capetinga",5.50],["Capitolio",3.20],["Carmo da Mata",3.20],["Carmo do Cajuru",3.20],["Carmo do Rio Claro",4.50],
  ["Carmopolis de Minas",4.00],["Carrancas",4.70],["Cassia",5.10],["Cedro do Abaete",5.00],["Claraval",6.00],
  ["Claudio",3.20],["Conceicao da Aparecida",5.10],["Conceicao do Para",3.20],["Coqueiral",4.00],["Corrego Danta",2.80],
  ["Corrego Fundo",1.69],["Cristais",3.10],["Crucilandia",4.40],["Delfinopolis",5.10],["Divinopolis",2.60],
  ["Dores do Indaia",3.40],["Doresopolis",2.04],["Eloi Mendes",5.40],["Engenheiro Ribeiro",2.90],["Estrela do Indaia",3.40],
  ["Fama",5.40],["Formiga",1.69],["Fortaleza de Minas",5.00],["Guape",5.00],["Guaranesia",5.40],
  ["Guaxupe",5.40],["Ibiraci",5.40],["Ibitira",3.80],["Ibituruna",5.00],["Iguatama",1.69],
  ["Ijaci",3.61],["Ilicinea",4.10],["Ingai",4.10],["Itamogi",5.60],["Itapecerica",2.47],
  ["Itatiaiucu",4.00],["Itau de Minas",4.40],["Itumirim",3.83],["Itutinga",4.05],["Jacui",5.15],
  ["Japaraiba",1.50],["Juruaia",4.75],["Lagoa da Prata",1.69],["Lambari",5.40],["Lavras",3.60],
  ["Leandro Ferreira",3.20],["Luminarias",4.90],["Luz",2.61],["Martinho Campos",3.40],["Medeiros",3.00],
  ["Moema",2.04],["Monsenhor Alexandre",3.50],["Monte Belo",5.20],["Monte Santo de Minas",5.00],["Morada Nova de Minas",5.20],
  ["Muzambinho",4.80],["Nepomuceno",3.60],["Nova Resende",4.70],["Nova Serrana",3.00],["Oliveira",3.60],
  ["Onca de Pitangui",3.61],["Paineiras",4.40],["Pains",1.69],["Para de Minas",3.83],["Paraguacu",5.10],
  ["Passa Tempo",3.95],["Passos",4.15],["Pedra do Indaia",2.04],["Perdigao",3.26],["Perdoes",3.26],
  ["Piedade dos Gerais",5.20],["Pimenta",2.04],["Piracema",4.40],["Pitangui",3.81],["Piumhi",2.26],
  ["Pompeu",3.80],["Pratapolis",4.15],["Quartel Geral",4.03],["Ribeirao Vermelho",3.40],["Rio Manso",4.80],
  ["Sao Joao Batista do Gloria",4.00],["Santo Antonio do Amparo",3.81],["Santo Antonio do Monte",2.04],["Santana da Vargem",4.00],["Sao Francisco de Paula",3.10],
  ["Sao Jose da Barra",3.40],["Sao Pedro da Uniao",5.40],["Sao Roque de Minas",3.70],["Sao Sebastiao do Paraiso",5.00],["Sao Tomas de Aquino",5.20],
  ["Serra da Saudade",3.65],["Santana do Jacare",2.90],["Tapirai",2.45],["Tres Pontas",4.80],["Vargem Bonita",3.40],["Varginha",5.00]
];
const initialReturnFreightRates = [
  ["Araujo",3.00],["Carmo do Cajuru",2.70],["Carmopolis de Minas",3.40],["Carmo da Mata",2.90],["Claudio",2.90],
  ["Divinopolis - Entrega",2.90],["Divinopolis",2.70],["Perdigao",3.00],["Sao Goncalo do Para",2.70],["Sao Sebastiao do Oeste",2.90],["Oliveira",3.00]
];

function applyInitialFreightRatesIfNeeded() {
  if (state.freightRatesImportVersion === freightRatesImportVersion) return;
  const addRates = (type, rates) => rates.forEach(([city, value], index) => {
    const existing = state.freightRates.find((rate) => rate.type === type && normalizeSearch(rate.city) === normalizeSearch(city));
    if (existing) existing.value = value;
    else state.freightRates.push({ id: `frete-${type}-${Date.now()}-${index}`, type, city, value });
  });
  addRates("entrega", initialDeliveryFreightRates);
  addRates("retorno", initialReturnFreightRates);
  state.freightRatesImportVersion = freightRatesImportVersion;
  localStorage.setItem("cimentoGestorState", JSON.stringify(state));
}

function importCustomerBatchIfNeeded() {
  const batch = Array.isArray(window.CIMENTO_CUSTOMER_BATCH) ? window.CIMENTO_CUSTOMER_BATCH : [];
  if (!batch.length) return false;
  if (state.customerBatchImportVersion === customerBatchImportVersion && state.customers.length) return false;

  const previousCustomers = new Map((state.customers || []).map((customer) => [
    cleanDocument(customer.document),
    customer
  ]));
  state.customers = [];
  batch.forEach((customer) => {
    const documentValue = cleanDocument(customer.document);
    if (![11, 14].includes(documentValue.length)) return;
    const previous = previousCustomers.get(documentValue);
    upsertCustomer({
      ...customer,
      document: documentValue,
      lastPrices: previous?.lastPrices || customer.lastPrices || {}
    });
  });
  state.customerBatchImportVersion = customerBatchImportVersion;
  localStorage.setItem("cimentoGestorState", JSON.stringify(state));
  return true;
}

const receitaMock = {
  "11222333000181": { name: "Construtora Alfa", address: "Av. Brasil, 1200 - Centro", phone: "(11) 3333-2020" },
  "12345678000195": { name: "Deposito Sao Joao", address: "Rua das Obras, 44 - Vila Industrial", phone: "(11) 98888-1010" },
  "52998247000160": { name: "Comercial de Cimentos Modelo Ltda", address: "Rua do Concreto, 85 - Distrito Comercial", phone: "(31) 3222-4500" },
  "39053364021": { name: "Cliente Pessoa Fisica Modelo", address: "Rua Particular, 25 - Centro", phone: "(11) 97777-5555" }
};

const certificateSupplierFilter = "CIA DE CIMENTO CAMPEAO ALVORADA";
const acceptedRecipientDocument = "04152053000189";

const savedState = safeLocalJson("cimentoGestorState", null);
if (savedState) {
  Object.assign(state, savedState);
}
if (Array.isArray(state.usersConfig) && state.usersConfig.length) {
  applyUsersConfig(state.usersConfig);
  syncUsersConfigToState();
} else {
  syncUsersConfigToState();
}
state.deletedOrders = Array.isArray(state.deletedOrders) ? state.deletedOrders : [];
state.deletedProductKeys = Array.isArray(state.deletedProductKeys) ? state.deletedProductKeys : [];
state.stock = Array.isArray(state.stock) ? state.stock.filter((product) => !isDeletedProduct(product)) : [];
state.reusableOrderIds = Array.isArray(state.reusableOrderIds) ? state.reusableOrderIds : [];
state.drivers = Array.isArray(state.drivers)
  ? cleanDriverOptions(state.drivers)
  : [];
state.freightRates = Array.isArray(state.freightRates) ? state.freightRates.map((rate, index) => ({
  id: rate.id || `frete-${Date.now()}-${index}`,
  type: ["entrega", "retorno", "galpao"].includes(rate.type) ? rate.type : "entrega",
  city: plainCustomerText(rate.city || ""),
  value: Number(rate.value || 0)
})).filter((rate) => rate.city) : [];
state.freightTypes = state.freightTypes && typeof state.freightTypes === "object" ? state.freightTypes : {};
applyInitialFreightRatesIfNeeded();
state.dashboardLockOverrides = state.dashboardLockOverrides && typeof state.dashboardLockOverrides === "object"
  ? state.dashboardLockOverrides
  : {};
if (state.dashboardLocked === true && state.dashboardLockOverrides[today] === undefined) {
  state.dashboardLockOverrides[today] = true;
}
state.dashboardLocked = false;
state.stockLockDate = String(state.stockLockDate || "");
importCustomerBatchIfNeeded();
state.orders.forEach((order) => {
  order.driver = order.driver || "";
  order.deliveryForecast = order.deliveryForecast || "";
  order.deliveryNote = order.deliveryNote || "";
  order.observation = order.observation || "";
  order.stockLocation = order.stockLocation || "Divinopolis";
  order.directLoad = Boolean(order.directLoad || order.sourceEntryId || order.sourceInvoice);
  order.panelDate = order.panelDate || "";
  order.dailyLoadSlot = order.dailyLoadSlot ?? "";
  if (!order.deliveryStatus) {
    order.deliveryStatus = "Entregue";
    order.stockPosted = true;
    return;
  }
  if (["Em carregamento", "Saiu para entrega"].includes(order.deliveryStatus)) {
    order.deliveryStatus = "Pedido";
  }
  order.stockPosted = order.deliveryStatus === "Entregue" ? true : Boolean(order.stockPosted);
  order.sellerUser = order.sellerUser || "nao-informado";
  order.sellerName = order.sellerName || "Nao informado";
  order.sellerRole = order.sellerRole || "Responsavel nao informado";
  order.salesperson = order.salesperson || "Nao informado";
  order.date = order.date || today;
  order.paymentTerm = order.paymentTerm || "";
  order.freightType = order.freightType === "retorno" ? "retorno" : "entrega";
});
state.stockEntries = state.stockEntries || [];
state.stockEntries.forEach((entry, index) => {
  entry.id = entry.id || `ENT-${entry.invoice || "SEMNF"}-${index}-${Date.now().toString().slice(-5)}`;
  entry.allocations = Array.isArray(entry.allocations) ? entry.allocations : [];
  entry.distributionStarted = Boolean(entry.distributionStarted || entry.allocations.length);
  entry.location = stockLocations.includes(entry.location) ? entry.location : "";
  entry.linkedOrderId = entry.linkedOrderId || "";
  entry.observation = entry.observation || "";
  const entryObservation = [entry.factoryOrder, entry.ovNumber, entry.observation].filter(Boolean).join(" ");
  const entryOvNumber = cleanOvNumber(entryObservation);
  const entryDriver = extractDriverName(entryObservation);
  entry.ovNumber = entryOvNumber || entry.ovNumber || "";
  if (entryOvNumber) entry.factoryOrder = entryOvNumber;
  if (entryDriver && (!entry.loadedBy || normalizeSearch(entry.loadedBy).includes("informado"))) {
    entry.loadedBy = entryDriver;
  }
  entry.loadedBy = cleanDriverName(entry.loadedBy);
});
applyManualStockNumberMigration();
state.notes = state.notes || [];
state.paymentMethods = Array.isArray(state.paymentMethods) && state.paymentMethods.length
  ? state.paymentMethods
  : [...defaultPaymentMethods];
const extractedPaymentTerms = state.paymentMethods.map(extractPaymentTerm).filter(Boolean);
state.paymentMethods = state.paymentMethods.filter((method) => !extractPaymentTerm(method));
state.paymentMethods = Array.from(new Set([...defaultPaymentMethods, ...state.paymentMethods].filter(Boolean)));
if (!state.paymentMethods.length) state.paymentMethods = [...defaultPaymentMethods];
state.paymentTerms = Array.isArray(state.paymentTerms) ? state.paymentTerms : [];
state.paymentTerms = Array.from(new Set([
  ...defaultPaymentTerms,
  ...state.paymentTerms.map((term) => plainCustomerText(term || "")),
  ...extractedPaymentTerms
].filter(Boolean)));
state.salespeople = Array.isArray(state.salespeople) && state.salespeople.length
  ? state.salespeople
  : ["Edmilson", "Edson", "Balcao", "Vendas externas", "Douglas"];
state.salespeople = Array.from(new Set(state.salespeople.map((seller) => String(seller || "").trim()).filter(Boolean)));
state.sellerCities = Array.isArray(state.sellerCities) ? state.sellerCities : [];
state.sellerCities = state.sellerCities.map((rule, index) => ({
  id: rule.id || `cidade-${Date.now()}-${index}`,
  city: String(rule.city || "").trim(),
  uf: String(rule.uf || "").trim().toUpperCase(),
  salesperson: state.salespeople.includes(rule.salesperson) ? rule.salesperson : state.salespeople[0] || ""
})).filter((rule) => rule.city && rule.salesperson);
applyDefaultSellerCitiesIfNeeded();
state.paymentRules = Array.isArray(state.paymentRules) ? state.paymentRules : [];
state.paymentRules = state.paymentRules.map((rule, index) => ({
  id: rule.id || `prazo-${Date.now()}-${index}`,
  type: ["city", "seller", "customer"].includes(rule.type) ? rule.type : "city",
  reference: plainCustomerText(rule.reference || ""),
  document: cleanDocument(rule.document || ""),
  payment: state.paymentMethods.includes(rule.payment) ? rule.payment : "Boleto",
  term: plainCustomerText(rule.term || "")
})).filter((rule) => rule.reference && rule.payment);
applyDefaultPaymentRulesIfNeeded();
state.paymentTerms = Array.from(new Set([
  ...state.paymentTerms,
  ...state.paymentRules.map((rule) => plainCustomerText(rule.term || "")),
  ...state.customers.map((customer) => plainCustomerText(customer.paymentTerm || ""))
].filter(Boolean)));
state.financialAccounts = Array.isArray(state.financialAccounts) && state.financialAccounts.length
  ? state.financialAccounts
  : [
    { id: "caixa", name: "Caixa", balance: 0 },
    { id: "banco", name: "Banco", balance: 0 },
    { id: "pix", name: "Pix", balance: 0 }
  ];
state.financialAccounts.forEach((account, index) => {
  account.id = account.id || makeId(account.name || `conta-${index}`);
  account.name = account.name || `Conta ${index + 1}`;
  account.balance = Number(account.balance || 0);
});
state.receivables = state.receivables || [];
state.customers = state.customers || [];
state.customers.forEach((customer) => {
  normalizeCustomerRecord(customer);
  customer.salesperson = state.salespeople.includes(customer.salesperson) ? customer.salesperson : "";
  customer.payment = state.paymentMethods.includes(customer.payment) ? customer.payment : "";
  customer.paymentTerm = plainCustomerText(customer.paymentTerm || "");
});
restoreDouglasSellerCitiesFromCustomers();
state.paymentRules.forEach((rule) => {
  if (rule.type !== "customer") return;
  const customer = rule.document
    ? state.customers.find((item) => item.document === rule.document)
    : state.customers.find((item) => normalizeSearch(item.name) === normalizeSearch(rule.reference));
  if (!customer) return;
  customersTextNormalized = true;
  customer.payment = state.paymentMethods.includes(rule.payment) ? rule.payment : customer.payment || "";
  customer.paymentTerm = plainCustomerText(rule.term || customer.paymentTerm || "");
});
if (state.paymentRules.some((rule) => rule.type === "customer")) {
  customersTextNormalized = true;
  state.paymentRules = state.paymentRules.filter((rule) => rule.type !== "customer");
}
if (customersTextNormalized) {
  localStorage.setItem("cimentoGestorState", JSON.stringify(state));
}
state.receivables.forEach((receivable, index) => {
  const order = state.orders.find((item) => item.id === receivable.origin);
  receivable.id = receivable.id || `${receivable.origin || "REC"}-P${index + 1}`;
  receivable.installment = receivable.installment || "1/1";
  receivable.payment = receivable.payment || order?.payment || state.paymentMethods[0] || "Boleto";
  receivable.accountId = receivable.accountId || "";
  receivable.value = Number(receivable.value || 0);
  receivable.paidValue = receivable.status === "Recebido"
    ? Number(receivable.paidValue || receivable.value || 0)
    : Number(receivable.paidValue || 0);
  receivable.salesperson = receivable.salesperson || order?.salesperson || "Nao informado";
  receivable.billingStatus = receivable.billingStatus || "Nao faturado";
  receivable.paymentDate = receivable.paymentDate || "";
});
state.notes.forEach((note) => {
  note.linkedOrderId = note.linkedOrderId || "";
  note.linkedOrderIds = Array.isArray(note.linkedOrderIds)
    ? note.linkedOrderIds
    : note.linkedOrderId ? [note.linkedOrderId] : [];
  const noteObservation = [note.factoryOrder, note.ovNumber].filter(Boolean).join(" ");
  const noteOvNumber = cleanOvNumber(noteObservation);
  note.factoryOrder = noteOvNumber || note.factoryOrder || "";
  note.loadedBy = cleanDriverName(note.loadedBy || "");
  note.ovNumber = noteOvNumber || note.ovNumber || "";
  note.location = note.location || "Divinopolis";
});
state.stock.forEach((item) => {
  item.locations = item.locations || { ...makeEmptyLocations(), "Divinopolis": Number(item.qty || 0) };
  stockLocations.forEach((location) => {
    item.locations[location] = Number(item.locations[location] || 0);
  });
  item.qty = stockLocations.reduce((sum, location) => sum + item.locations[location], 0);
});
if (cleanupDuplicateImportedStockEntries()) {
  localStorage.setItem("cimentoGestorState", JSON.stringify(state));
}

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc>
  <NFe>
    <infNFe>
      <ide><nNF>000512</nNF><dhEmi>2026-06-05T09:30:00-03:00</dhEmi></ide>
      <emit><xNome>Cimentos Centro Sul Ltda</xNome></emit>
      <det nItem="1">
        <prod><cProd>CP2-50-CS</cProd><xProd>Cimento CP II 50kg Marca Centro Sul</xProd><qCom>800</qCom></prod>
      </det>
      <det nItem="2">
        <prod><cProd>CP3-40-CS</cProd><xProd>Cimento CP III 40kg Marca Centro Sul</xProd><qCom>240</qCom></prod>
      </det>
      <infAdic><infCpl>Numero OVs: 4500123456; Motorista: JOAO SILVA</infCpl></infAdic>
    </infNFe>
  </NFe>
</nfeProc>`;

const sefazSampleXmls = [
  `<?xml version="1.0" encoding="UTF-8"?>
  <nfeProc>
    <NFe>
      <infNFe>
        <ide><nNF>000913</nNF><dhEmi>2026-06-05T08:15:00-03:00</dhEmi></ide>
        <emit><xNome>CIA DE CIMENTO CAMPEAO ALVORADA</xNome></emit>
        <det nItem="1">
          <prod><cProd>CP2-50-CA</cProd><xProd>Cimento CP II 50kg Campeao Alvorada</xProd><qCom>500</qCom></prod>
        </det>
        <infAdic><infCpl>Numero OVs: 4500987654; Motorista: CARLOS LIMA</infCpl></infAdic>
      </infNFe>
    </NFe>
  </nfeProc>`,
  `<?xml version="1.0" encoding="UTF-8"?>
  <nfeProc>
    <NFe>
      <infNFe>
        <ide><nNF>000914</nNF><dhEmi>2026-06-05T10:40:00-03:00</dhEmi></ide>
        <emit><xNome>Cimentos Nacional Ltda</xNome></emit>
        <det nItem="1">
          <prod><cProd>CP3-40-NC</cProd><xProd>Cimento CP III 40kg Nacional</xProd><qCom>320</qCom></prod>
        </det>
        <infAdic><infCpl>Numero OVs: 4500777788; Motorista: PEDRO ALVES</infCpl></infAdic>
      </infNFe>
    </NFe>
  </nfeProc>`
];

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function makeId(value) {
  const base = normalizeSearch(value || "item").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "item"}-${Date.now().toString().slice(-5)}`;
}

function saveState() {
  localStorage.setItem("cimentoGestorState", JSON.stringify(state));
  saveStateToCloud();
}

function saveStateToCloud() {
  if (!cloudReady || !cloudDocRef || cloudLoading || applyingCloudState) return;
  cloudPendingLocalChanges = true;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(saveStateToCloudNow, 1500);
}

function cloudSafeState() {
  return JSON.parse(JSON.stringify(state, (_key, value) => {
    if (value === undefined) return null;
    if (typeof value === "number" && !Number.isFinite(value)) return 0;
    return value;
  }));
}

function setupCloudDocumentRefs(settings) {
  const documentPath = settings.documentPath || "empresas/cimento-e-cia";
  const segments = documentPath.split("/").filter(Boolean);
  if (segments.length < 2 || segments.length % 2 !== 0) {
    throw new Error("documentPath invalido no firebase-config.js");
  }
  const collectionPath = segments.slice(0, -1).join("/");
  cloudDocumentId = segments[segments.length - 1];
  cloudCollectionRef = cloudDb.collection(collectionPath);
  cloudDocRef = cloudCollectionRef.doc(cloudDocumentId);
}

function cloudChunkDoc(index) {
  return cloudCollectionRef.doc(`${cloudDocumentId}-chunk-${String(index).padStart(4, "0")}`);
}

async function readCloudStateFromSnapshot(snapshot) {
  if (!snapshot.exists) return { exists: false, state: null };
  const data = snapshot.data() || {};
  if (data.state) {
    cloudChunkCount = 0;
    cloudRevision = data.revision || "";
    return { exists: true, state: data.state };
  }
  if (data.stateFormat !== "chunks-v1" || !Number(data.chunkCount)) {
    cloudChunkCount = Number(data.chunkCount || 0);
    cloudRevision = data.revision || "";
    return { exists: true, state: null };
  }
  const count = Number(data.chunkCount || 0);
  const chunkReads = [];
  for (let index = 0; index < count; index += 1) {
    chunkReads.push(cloudChunkDoc(index).get());
  }
  const chunkSnapshots = await Promise.all(chunkReads);
  const stateJson = chunkSnapshots
    .map((chunkSnapshot) => chunkSnapshot.data()?.text || "")
    .join("");
  cloudChunkCount = count;
  cloudRevision = data.revision || "";
  return { exists: true, state: stateJson ? JSON.parse(stateJson) : null };
}

async function readCloudState() {
  return readCloudStateFromSnapshot(await cloudDocRef.get());
}

async function writeCloudState(extra = {}) {
  const stateJson = JSON.stringify(cloudSafeState());
  const chunks = [];
  for (let index = 0; index < stateJson.length; index += cloudChunkSize) {
    chunks.push(stateJson.slice(index, index + cloudChunkSize));
  }
  const revision = `${Date.now()}-${chunks.length}-${stateJson.length}`;
  const batch = cloudDb.batch();
  chunks.forEach((text, index) => {
    batch.set(cloudChunkDoc(index), {
      index,
      text,
      revision,
      updatedAt: new Date().toISOString()
    });
  });
  for (let index = chunks.length; index < cloudChunkCount; index += 1) {
    batch.delete(cloudChunkDoc(index));
  }
  const deleteOldInlineState = window.firebase?.firestore?.FieldValue?.delete;
  batch.set(cloudDocRef, {
    ...extra,
    updatedAt: new Date().toISOString(),
    stateFormat: "chunks-v1",
    chunkCount: chunks.length,
    stateSize: stateJson.length,
    revision,
    ...(deleteOldInlineState ? { state: deleteOldInlineState() } : {})
  }, { merge: true });
  await batch.commit();
  cloudChunkCount = chunks.length;
  cloudRevision = revision;
}

function mergeArrayByKey(baseItems, localItems, keyFn) {
  const merged = [];
  const seen = new Set();
  [...(baseItems || []), ...(localItems || [])].forEach((item) => {
    if (!item) return;
    const key = keyFn(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

function cloneStateSnapshot(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function mergePrimitiveArray(remoteItems, localItems, cleanFn = (value) => value) {
  const merged = [];
  const seen = new Set();
  [...(remoteItems || []), ...(localItems || [])].forEach((item) => {
    const value = cleanFn(item);
    const key = normalizeSearch(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(value);
  });
  return merged;
}

function mergeObjectArray(remoteItems, localItems, keyFn) {
  const map = new Map();
  [...(remoteItems || []), ...(localItems || [])].forEach((item) => {
    if (!item) return;
    const key = keyFn(item);
    if (!key) return;
    map.set(key, { ...(map.get(key) || {}), ...item });
  });
  return Array.from(map.values());
}

function mergeCloudAndLocalState(remoteState, localState) {
  const merged = Object.assign(
    cloneStateSnapshot(emptyStateTemplate),
    cloneStateSnapshot(remoteState),
    cloneStateSnapshot(localState)
  );
  merged.stock = mergeObjectArray(remoteState?.stock, localState?.stock, (item) => item.id || normalizeSearch(item.product));
  merged.orders = mergeObjectArray(remoteState?.orders, localState?.orders, (item) => item.id);
  merged.deletedOrders = mergeObjectArray(remoteState?.deletedOrders, localState?.deletedOrders, (item) => item.orderId || item.id);
  const deletedOrderIds = new Set((merged.deletedOrders || []).map((item) => item.orderId || item.id).filter(Boolean));
  merged.orders = (merged.orders || []).filter((order) => !deletedOrderIds.has(order.id));
  merged.deletedProductKeys = mergePrimitiveArray(remoteState?.deletedProductKeys, localState?.deletedProductKeys, (value) => String(value || "").trim());
  merged.stock = (merged.stock || []).filter((product) => !isDeletedProduct(product, merged.deletedProductKeys));
  merged.customers = mergeObjectArray(remoteState?.customers, localState?.customers, (item) => cleanDocument(item.document) || normalizeSearch(item.name));
  merged.receivables = mergeObjectArray(remoteState?.receivables, localState?.receivables, (item) => item.id || `${item.origin || ""}-${item.installment || ""}-${item.dueDate || ""}`);
  merged.usersConfig = mergeObjectArray(remoteState?.usersConfig, localState?.usersConfig, (item) => item.user || normalizeSearch(item.name));
  merged.sellerCities = mergeObjectArray(remoteState?.sellerCities, localState?.sellerCities, (item) => item.id || `${normalizeSearch(item.salesperson)}-${normalizeSearch(item.city)}`);
  merged.paymentRules = mergeObjectArray(remoteState?.paymentRules, localState?.paymentRules, (item) => item.id || `${item.type || ""}-${normalizeSearch(item.reference)}-${normalizeSearch(item.method)}-${normalizeSearch(item.term)}`);
  merged.freightRates = mergeObjectArray(remoteState?.freightRates, localState?.freightRates, (item) => item.id || `${item.type || ""}-${normalizeSearch(item.city)}`);
  merged.financialAccounts = mergeObjectArray(remoteState?.financialAccounts, localState?.financialAccounts, (item) => item.id || normalizeSearch(item.name));
  merged.notes = mergeObjectArray(remoteState?.notes, localState?.notes, (item) => item.id || item.invoice || item.key);
  merged.stockEntries = mergeObjectArray(remoteState?.stockEntries, localState?.stockEntries, (item) => item.id || `${item.invoice || ""}-${normalizeSearch(item.product)}-${normalizeLocation(item.location)}-${item.quantity || ""}-${item.date || ""}`);
  merged.movements = mergeObjectArray(remoteState?.movements, localState?.movements, (item) => item.id || item.sourceId || `${item.sourceInvoice || ""}-${item.allocationId || ""}-${item.date || ""}-${normalizeSearch(item.op)}-${normalizeSearch(item.product)}-${item.qty || ""}`);
  merged.salespeople = mergePrimitiveArray(remoteState?.salespeople, localState?.salespeople, (value) => normalizeSearch(value));
  merged.drivers = mergePrimitiveArray(remoteState?.drivers, localState?.drivers, (value) => cleanDriverName(value));
  merged.paymentMethods = mergePrimitiveArray(remoteState?.paymentMethods, localState?.paymentMethods, (value) => normalizeSearch(value));
  merged.paymentTerms = mergePrimitiveArray(remoteState?.paymentTerms, localState?.paymentTerms, (value) => String(value || "").trim());
  merged.freightTypes = { ...(remoteState?.freightTypes || {}), ...(localState?.freightTypes || {}) };
  merged.dashboardLockOverrides = { ...(remoteState?.dashboardLockOverrides || {}), ...(localState?.dashboardLockOverrides || {}) };
  merged.manualStockSequence = Math.max(Number(remoteState?.manualStockSequence || 0), Number(localState?.manualStockSequence || 0));
  merged.reusableOrderIds = mergePrimitiveArray(remoteState?.reusableOrderIds, localState?.reusableOrderIds, (value) => String(value || "").trim());
  return merged;
}

function replaceStateContents(nextState) {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, cloneStateSnapshot(emptyStateTemplate), nextState || {});
}

function applyMergedCloudState(cloudState, shouldKeepLocalPendingChanges = false) {
  const localSnapshot = cloneStateSnapshot(state);
  const nextState = shouldKeepLocalPendingChanges
    ? mergeCloudAndLocalState(cloudState || {}, localSnapshot)
    : cloneStateSnapshot(cloudState || {});
  replaceStateContents(nextState);
  if (Array.isArray(state.usersConfig) && state.usersConfig.length) {
    applyUsersConfig(state.usersConfig);
    syncUsersConfigToState();
  } else {
    syncUsersConfigToState();
  }
  const cleanedDuplicateEntries = cleanupDuplicateImportedStockEntries();
  const cleanedDivinopolisCustomers = removeLegacyDivinopolisEdmilsonAssignments();
  return cleanedDuplicateEntries || cleanedDivinopolisCustomers;
}

async function mergeLatestCloudStateBeforeSave() {
  if (!cloudReady || !cloudDocRef || cloudLoading || applyingCloudState) return;
  const localSnapshot = cloudSafeState();
  const latestCloud = await readCloudState();
  if (!latestCloud.exists || !latestCloud.state) return;
  replaceStateContents(mergeCloudAndLocalState(latestCloud.state, localSnapshot));
  localStorage.setItem("cimentoGestorState", JSON.stringify(state));
}

function applyCloudStateWithLocalBackup(cloudState, _localState) {
  return applyMergedCloudState(cloudState, false);
}

function persistCleanedCloudState() {
  saveState();
  window.setTimeout(() => saveStateToCloudNow(), 800);
}

async function saveStateToCloudNow() {
  if (!cloudReady || !cloudDocRef || cloudLoading || applyingCloudState) return;
  try {
    window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
    cloudPendingLocalChanges = true;
    await mergeLatestCloudStateBeforeSave();
    await writeCloudState();
    cloudPendingLocalChanges = false;
  } catch (error) {
    cloudPendingLocalChanges = true;
    console.error("Erro ao salvar no Firebase:", error);
    lastCloudError = error?.code || error?.message || "erro ao salvar";
    showCloudError(`Firebase nao salvou: ${lastCloudError}`);
  }
}

async function initFirebaseSync() {
  const settings = window.CIMENTO_FIREBASE;
  if (!settings?.enabled) return;
  if (!window.firebase?.initializeApp || !window.firebase?.firestore || !window.firebase?.auth) {
    lastCloudError = "SDK do Firebase nao carregou";
    showCloudError("Firebase nao carregou. Verifique a internet ou publique a versao atualizada.");
    return;
  }

  try {
    lastCloudError = "";
    clearCloudError();
    if (!window.firebase.apps?.length) {
      window.firebase.initializeApp(settings.config);
    }
    firebaseAuth = window.firebase.auth();
    firebaseReady = true;
    if (!firebaseAuth.currentUser) return;
    cloudDb = window.firebase.firestore();
    try {
      cloudDb.settings({ ignoreUndefinedProperties: true });
    } catch (_error) {
      // Settings can only be applied once per page load.
    }
    setupCloudDocumentRefs(settings);
    cloudReady = true;

    if (settings.syncEnabled === false) {
      showToast("Firebase pausado. Alterações ficam somente neste computador.");
      return;
    }

    cloudLoading = true;
    const cloudStateResult = await readCloudState();
    if (cloudStateResult.exists && cloudStateResult.state) {
      applyingCloudState = true;
      const cleanedCloudState = applyCloudStateWithLocalBackup(cloudStateResult.state);
      localStorage.setItem("cimentoGestorState", JSON.stringify(state));
      renderAll();
      applyingCloudState = false;
      if (cleanedCloudState) persistCleanedCloudState();
      showToast("Dados online carregados.");
    } else {
      await writeCloudState({ createdAt: new Date().toISOString() });
      showToast("Firebase conectado. Base inicial criada.");
    }
    if (cloudUnsubscribe) cloudUnsubscribe();
    cloudUnsubscribe = cloudDocRef.onSnapshot(async (liveSnapshot) => {
      if (!liveSnapshot.exists || cloudLoading) return;
      const liveData = liveSnapshot.data() || {};
      if (liveData.revision && liveData.revision === cloudRevision) return;
      const liveCloudState = await readCloudStateFromSnapshot(liveSnapshot);
      if (!liveCloudState.state) return;
      applyingCloudState = true;
      const cleanedLiveState = applyMergedCloudState(liveCloudState.state, cloudPendingLocalChanges);
      localStorage.setItem("cimentoGestorState", JSON.stringify(state));
      renderAll();
      applyingCloudState = false;
      if (cleanedLiveState) persistCleanedCloudState();
    }, (error) => {
      console.error("Erro ao sincronizar Firebase:", error);
      lastCloudError = error?.code || error?.message || "erro em tempo real";
      showCloudError(`Firebase em tempo real falhou: ${lastCloudError}`);
    });
  } catch (error) {
    console.error("Erro ao conectar Firebase:", error);
    cloudReady = false;
    lastCloudError = error?.code || error?.message || "erro desconhecido";
    showCloudError(`Firebase nao conectou: ${lastCloudError}`);
  } finally {
    cloudLoading = false;
  }
}

async function initFirebaseAppOnly() {
  const settings = window.CIMENTO_FIREBASE;
  if (!settings?.enabled) return;
  if (!window.firebase?.initializeApp || !window.firebase?.auth) return;
  if (!window.firebase.apps?.length) {
    window.firebase.initializeApp(settings.config);
  }
  firebaseAuth = window.firebase.auth();
  firebaseReady = true;
}

function debounce(callback, delay = 350) {
  let timeout;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => callback(...args), delay);
  };
}

function showToast(message) {
  const toast = qs("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  const delay = String(message || "").toLowerCase().includes("firebase") ? 15000 : 2800;
  window.setTimeout(() => toast.classList.remove("show"), delay);
}

function showCloudError(message) {
  const finalMessage = message || "Firebase nao conectou. Confira dominio, regras e internet.";
  showToast(finalMessage);
  const loginError = qs("#login-error");
  if (loginError) loginError.textContent = finalMessage;
  let banner = qs("#firebase-error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "firebase-error-banner";
    banner.style.cssText = [
      "position:fixed",
      "left:16px",
      "right:16px",
      "bottom:16px",
      "z-index:9999",
      "background:#b42318",
      "color:#fff",
      "padding:14px 16px",
      "border-radius:8px",
      "font-weight:800",
      "box-shadow:0 12px 30px rgba(0,0,0,.25)"
    ].join(";");
    document.body.appendChild(banner);
  }
  banner.textContent = finalMessage;
}

function clearCloudError() {
  const banner = qs("#firebase-error-banner");
  if (banner) banner.remove();
}

function saveUsersConfig() {
  const activeUserConfig = currentSessionUser
    ? users.find((item) => item.user === currentSessionUser.user)
    : null;
  if (activeUserConfig) {
    currentSessionUser = {
      ...currentSessionUser,
      name: activeUserConfig.name,
      role: activeUserConfig.role,
      permissions: { ...defaultPermissions(), ...(activeUserConfig.permissions || {}) }
    };
    localStorage.setItem("cimentoGestorSession", JSON.stringify({
      user: currentSessionUser.user,
      name: currentSessionUser.name,
      role: currentSessionUser.role,
      permissions: currentSessionUser.permissions
    }));
  }
  syncUsersConfigToState();
  localStorage.setItem("cimentoGestorUsers", JSON.stringify(state.usersConfig));
  saveState();
  saveStateToCloudNow();
}

function getLoggedUser() {
  if (currentSessionUser) return currentSessionUser;
  const savedSession = safeLocalJson("cimentoGestorSession", null);
  if (savedSession?.user) {
    const savedConfig = users.find((item) => item.user === savedSession.user);
    currentSessionUser = {
      ...savedSession,
      permissions: { ...defaultPermissions(), ...(savedConfig?.permissions || savedSession.permissions || {}) }
    };
    return currentSessionUser;
  }
  const savedUser = localStorage.getItem("cimentoGestorUser");
  return users.find((item) => item.user === savedUser);
}

function saveLoginSession(user) {
  currentSessionUser = user;
  localStorage.setItem("cimentoGestorUser", user.user);
  localStorage.setItem("cimentoGestorSession", JSON.stringify({
    user: user.user,
    name: user.name,
    role: user.role,
    permissions: user.permissions || defaultPermissions()
  }));
}

function showLogin() {
  document.body.classList.add("login-active");
  qs("#login-error").textContent = "";
  qs("#login-user").focus();
}

function showSystem(user) {
  document.body.classList.remove("login-active");
  qs("#current-user").textContent = user.name;
  applyUserPermissions(user);
}

function refreshCurrentUserLabel() {
  const user = getLoggedUser();
  if (user && !document.body.classList.contains("login-active")) {
    showSystem(user);
  }
}

function userProfileFromEmail(email) {
  const login = String(email || "").split("@")[0].toLowerCase();
  const saved = users.find((item) => {
    return item.user === login || normalizeSearch(item.name) === normalizeSearch(login);
  });
  return saved || {
    user: login || email,
    name: saved?.name || login || email,
    role: saved?.role || "Usuario"
  };
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const login = String(data.get("user")).trim().toLowerCase();
  const password = String(data.get("password") || "");

  if (!password) {
    qs("#login-error").textContent = "Digite a senha para entrar.";
    return;
  }

  if (window.CIMENTO_FIREBASE?.enabled && !login.includes("@")) {
    qs("#login-error").textContent = "Digite o e-mail cadastrado no Firebase.";
    return;
  }

  if (window.CIMENTO_FIREBASE?.enabled && (!firebaseReady || !firebaseAuth)) {
    showCloudError("Firebase nao carregou. Publique a versao atual e confira a internet.");
    return;
  }

  if (firebaseReady && firebaseAuth && login.includes("@")) {
    try {
      firebaseLoginInProgress = true;
      const credential = await firebaseAuth.signInWithEmailAndPassword(login, password);
      saveLoginSession(userProfileFromEmail(credential.user.email));
      await initFirebaseSync();
      if (!cloudReady) {
        showCloudError(`Login aceito, mas o Firestore nao conectou: ${lastCloudError || "confira regras do banco e internet"}.`);
        firebaseLoginInProgress = false;
      }
      form.reset();
      showSystem(currentSessionUser);
      showToast(cloudReady ? "Login seguro realizado pelo Firebase." : "Login realizado. Firebase ainda nao sincronizou.");
      firebaseLoginInProgress = false;
      return;
    } catch (error) {
      firebaseLoginInProgress = false;
      const messages = {
        "auth/invalid-credential": "E-mail ou senha incorretos no Firebase.",
        "auth/invalid-login-credentials": "E-mail ou senha incorretos no Firebase.",
        "auth/user-not-found": "Este e-mail nao esta cadastrado no Firebase.",
        "auth/wrong-password": "Senha incorreta para este e-mail.",
        "auth/invalid-email": "Digite um e-mail valido.",
        "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
        "auth/unauthorized-domain": "Este dominio ainda nao esta autorizado no Firebase.",
        "auth/network-request-failed": "Falha de internet ao consultar o Firebase.",
        "auth/operation-not-allowed": "Ative o metodo E-mail/senha no Firebase Authentication."
      };
      qs("#login-error").textContent = messages[error.code] || `Erro no Firebase: ${error.code || error.message}`;
      return;
    }
  }

  qs("#login-error").textContent = "Login local desativado por seguranca. Use o Firebase Auth.";
}

async function logout() {
  if (cloudUnsubscribe) {
    cloudUnsubscribe();
    cloudUnsubscribe = null;
  }
  cloudReady = false;
  if (firebaseAuth?.currentUser) {
    await firebaseAuth.signOut();
  }
  currentSessionUser = null;
  localStorage.removeItem("cimentoGestorUser");
  localStorage.removeItem("cimentoGestorSession");
  showLogin();
}

function initLogin() {
  qs("#login-form").addEventListener("submit", handleLogin);
  qs("#logout-btn").addEventListener("click", logout);

  if (firebaseAuth) {
    firebaseAuth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        if (firebaseLoginInProgress) return;
        await firebaseAuth.signOut();
        currentSessionUser = null;
        localStorage.removeItem("cimentoGestorUser");
        localStorage.removeItem("cimentoGestorSession");
        showLogin();
      } else {
        showLogin();
      }
    });
    return;
  }
  if (window.CIMENTO_FIREBASE?.enabled) {
    showLogin();
    showCloudError("Firebase nao carregou. Abra pelo link publicado e confira a internet.");
    return;
  }
  const user = getLoggedUser();
  if (user) showSystem(user);
  else showLogin();
}

function renderUsersSettings() {
  qs("#users-settings-table").innerHTML = users.map((user) => `
    <tr>
      <td><input class="settings-input" data-config-name="${user.user}" value="${user.name}" /></td>
      <td class="right"><button class="stage-btn" type="button" data-save-user="${user.user}">Salvar</button></td>
    </tr>
  `).join("");
  renderUserPermissions();
}

function renderUserPermissions() {
  const table = qs("#user-permissions-table");
  if (!table) return;
  table.innerHTML = users.map((user) => {
    const permissions = userPermissions(user);
    return `
      <tr>
        <td><strong>${user.name}</strong></td>
        ${permissionModules.map((module) => `
          <td class="center">
            <input class="permission-check" type="checkbox" data-permission-user="${user.user}" data-permission-view="${module.id}" ${permissions[module.id] !== false ? "checked" : ""} />
          </td>
        `).join("")}
        <td class="right"><button class="stage-btn" type="button" data-save-permissions="${user.user}">Salvar</button></td>
      </tr>
    `;
  }).join("");
}

function renderPaymentMethods() {
  const options = state.paymentMethods.map((method) => `<option value="${escapeAttr(method)}">${method}</option>`).join("");
  qsa('[name="payment"], [data-receivable-payment]').forEach((select) => {
    const current = select.value || select.dataset.current || state.paymentMethods[0] || "";
    select.innerHTML = options;
    select.value = state.paymentMethods.includes(current) ? current : state.paymentMethods[0] || "";
  });
  const methodsRows = state.paymentMethods.map((method) => `
    <tr>
      <td><input class="settings-input" data-payment-method="${escapeAttr(method)}" value="${escapeAttr(method)}" /></td>
      <td class="right">
        <button class="stage-btn" type="button" data-save-payment="${escapeAttr(method)}">Salvar</button>
        <button class="danger-btn" type="button" data-delete-payment="${escapeAttr(method)}">Excluir</button>
      </td>
    </tr>
  `).join("");
  const configCount = qs("#payment-methods-count");
  const configTable = qs("#payment-methods-table");
  const clientCount = qs("#client-payment-methods-count");
  const clientTable = qs("#client-payment-methods-table");
  const financeCount = qs("#finance-payment-methods-count");
  const financeTable = qs("#finance-payment-methods-table");
  if (configCount) configCount.textContent = `${state.paymentMethods.length} formas`;
  if (configTable) configTable.innerHTML = methodsRows;
  if (clientCount) clientCount.textContent = `${state.paymentMethods.length} formas`;
  if (clientTable) clientTable.innerHTML = methodsRows;
  if (financeCount) financeCount.textContent = `${state.paymentMethods.length} formas`;
  if (financeTable) financeTable.innerHTML = methodsRows;
  renderCustomerPaymentOptions();
  renderPaymentTerms();
  renderPaymentRulesSettings();
}

function paymentMethodOptions(selected = "") {
  return state.paymentMethods.map((method) => `<option value="${escapeAttr(method)}" ${method === selected ? "selected" : ""}>${method}</option>`).join("");
}

function renderCustomerPaymentOptions(selected = "") {
  const select = qs("#customer-payment");
  if (!select) return;
  const current = selected || select.value || state.paymentMethods[0] || "";
  select.innerHTML = state.paymentMethods
    .map((method) => `<option value="${escapeAttr(method)}" ${method === current ? "selected" : ""}>${method}</option>`)
    .join("");
  select.value = state.paymentMethods.includes(current) ? current : state.paymentMethods[0] || "";
}

function renderCustomerPaymentTermOptions(selected = "") {
  const select = qs("#customer-payment-term");
  if (!select) return;
  const current = selected || select.value || state.paymentTerms[0] || "";
  select.innerHTML = state.paymentTerms.length
    ? state.paymentTerms.map((term) => `<option value="${escapeAttr(term)}" ${term === current ? "selected" : ""}>${term}</option>`).join("")
    : `<option value="">Nenhum prazo cadastrado</option>`;
  select.value = state.paymentTerms.includes(current) ? current : state.paymentTerms[0] || "";
}

function renderPaymentTerms() {
  const rows = state.paymentTerms.length ? state.paymentTerms.map((term) => `
    <tr>
      <td><input class="settings-input" data-payment-term="${escapeAttr(term)}" value="${escapeAttr(term)}" /></td>
      <td class="right">
        <button class="stage-btn" type="button" data-save-term="${escapeAttr(term)}">Salvar</button>
        <button class="danger-btn" type="button" data-delete-term="${escapeAttr(term)}">Excluir</button>
      </td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="2" class="empty-row">Nenhum prazo cadastrado.</td>
    </tr>
  `;
  [
    ["#payment-terms-count", "#payment-terms-table"],
    ["#client-payment-terms-count", "#client-payment-terms-table"],
    ["#finance-payment-terms-count", "#finance-payment-terms-table"]
  ].forEach(([countSelector, tableSelector]) => {
    const count = qs(countSelector);
    const table = qs(tableSelector);
    if (count) count.textContent = `${state.paymentTerms.length} prazos`;
    if (table) table.innerHTML = rows;
  });
  renderCustomerPaymentTermOptions();
}

function renderPaymentRuleReferenceOptions() {
  const type = qs("#payment-rule-type")?.value || "city";
  const select = qs("#payment-rule-reference");
  if (!select) return;
  const current = select.value || "";
  const options = type === "seller"
    ? state.salespeople
    : Array.from(new Set([
      ...state.sellerCities.map((rule) => rule.city),
      ...state.paymentRules.filter((rule) => rule.type === "city").map((rule) => rule.reference)
    ].filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  select.innerHTML = options.length
    ? options.map((value) => `<option value="${escapeAttr(value)}" ${normalizeSearch(value) === normalizeSearch(current) ? "selected" : ""}>${value}</option>`).join("")
    : `<option value="">Nenhuma opção cadastrada</option>`;
  if (!options.some((value) => normalizeSearch(value) === normalizeSearch(current))) {
    select.value = options[0] || "";
  }
}

function renderPaymentRuleTermOptions(selected = "") {
  const select = qs("#payment-rule-term");
  if (!select) return;
  const current = selected || select.value || "";
  const options = state.paymentTerms;
  select.innerHTML = options.length
    ? options.map((value) => `<option value="${escapeAttr(value)}" ${value === current ? "selected" : ""}>${value}</option>`).join("")
    : `<option value="">Nenhum prazo cadastrado</option>`;
  select.value = options.includes(current) ? current : options[0] || "";
}

function renderPaymentRulesSettings() {
  const methodSelect = qs("#payment-rule-method");
  if (methodSelect) methodSelect.innerHTML = paymentMethodOptions(methodSelect.value || "Boleto");
  renderPaymentRuleReferenceOptions();
  renderPaymentRuleTermOptions();
  const visibleRules = state.paymentRules.filter((rule) => rule.type !== "customer");
  const count = qs("#payment-rules-count");
  if (count) count.textContent = `${visibleRules.length} regras`;
  const table = qs("#payment-rules-table");
  if (!table) return;
  table.innerHTML = visibleRules.length ? visibleRules.map((rule) => `
    <tr>
      <td>${rule.type === "customer" ? "Cliente" : rule.type === "seller" ? "Vendedor" : "Cidade"}</td>
      <td>${rule.reference}</td>
      <td>${rule.payment}</td>
      <td>${rule.term}</td>
      <td class="right">
        <button class="danger-btn" type="button" data-delete-payment-rule="${rule.id}">Excluir</button>
      </td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="5" class="empty-row">Nenhuma regra cadastrada.</td>
    </tr>
  `;
}

function renderSalespeopleSettings() {
  const options = salespersonOptions();
  qsa('[name="salesperson"]').forEach((select) => {
    const current = select.value || select.dataset.current || state.salespeople[0] || "";
    select.innerHTML = options;
    select.value = state.salespeople.includes(current) ? current : state.salespeople[0] || "";
  });
  const count = qs("#salespeople-count");
  if (count) count.textContent = `${state.salespeople.length} vendedores`;
  const customerSellerFilter = qs("#customers-seller-filter");
  if (customerSellerFilter) {
    const current = customerSellerFilter.value || "";
    customerSellerFilter.innerHTML = [
      `<option value="">Todos os vendedores</option>`,
      ...state.salespeople.map((seller) => `<option value="${escapeAttr(seller)}" ${seller === current ? "selected" : ""}>${seller}</option>`)
    ].join("");
    customerSellerFilter.value = state.salespeople.includes(current) ? current : "";
  }
  const table = qs("#salespeople-table");
  if (!table) return;
  table.innerHTML = state.salespeople.map((seller) => `
    <tr>
      <td><input class="settings-input" data-salesperson="${escapeAttr(seller)}" value="${escapeAttr(seller)}" /></td>
      <td class="right">
        <button class="stage-btn" type="button" data-save-salesperson="${escapeAttr(seller)}">Salvar</button>
        <button class="danger-btn" type="button" data-delete-salesperson="${escapeAttr(seller)}">Excluir</button>
      </td>
    </tr>
  `).join("");
  renderCustomerSalespersonOptions();
  renderSellerCitiesSettings();
}

function renderDriversSettings() {
  const count = qs("#drivers-count");
  if (count) count.textContent = `${state.drivers.length} motoristas`;
  const table = qs("#drivers-table");
  if (!table) return;
  table.innerHTML = state.drivers.length ? state.drivers.map((driver) => `
    <tr>
      <td><input class="settings-input" data-driver="${escapeAttr(driver)}" value="${escapeAttr(driver)}" /></td>
      <td class="right">
        <button class="stage-btn" type="button" data-save-driver="${escapeAttr(driver)}">Salvar</button>
        <button class="danger-btn" type="button" data-delete-driver="${escapeAttr(driver)}">Excluir</button>
      </td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="2" class="empty-row">Nenhum motorista cadastrado.</td>
    </tr>
  `;
}

function salespersonOptions(selected = "") {
  return state.salespeople.map((seller) => `<option value="${escapeAttr(seller)}" ${seller === selected ? "selected" : ""}>${seller}</option>`).join("");
}

function renderCustomerSalespersonOptions(selected = "") {
  const select = qs("#customer-salesperson");
  if (!select) return;
  const current = selected || select.value || state.salespeople[0] || "";
  select.innerHTML = state.salespeople
    .map((seller) => `<option value="${escapeAttr(seller)}" ${seller === current ? "selected" : ""}>${seller}</option>`)
    .join("");
  select.value = state.salespeople.includes(current) ? current : state.salespeople[0] || "";
}

function customerCityText(customer) {
  const directCity = String(customer?.city || "").trim();
  if (directCity) return directCity;
  const address = normalizeSearch(customer?.address || "");
  const rule = state.sellerCities.find((item) => address.includes(normalizeSearch(item.city)));
  if (rule) return rule.city;
  return "";
}

function shortCityName(city) {
  const words = plainCustomerText(city)
    .split(/\s+/)
    .filter((word) => word && !["DA", "DE", "DO", "DAS", "DOS"].includes(word));
  return words.slice(0, 2).join(" ");
}

function customerAddressWithoutCity(customer) {
  const detailedAddress = [
    customer?.street,
    customer?.number,
    customer?.complement,
    customer?.neighborhood
  ].filter(Boolean).join(", ");
  if (detailedAddress) return detailedAddress;
  const city = normalizeSearch(customerCityText(customer));
  if (!city) return customer?.address || "-";
  const parts = String(customer?.address || "").split(",").map((part) => part.trim()).filter(Boolean);
  const filtered = parts.filter((part) => normalizeSearch(part) !== city && !normalizeSearch(part).includes(`${city} `));
  const withoutCep = filtered.join(", ").replace(/\bCEP\s*\d{5,8}\b/gi, "").replace(/,\s*$/, "").trim();
  return withoutCep || customer?.address || "-";
}

function normalizeSalespersonName(name) {
  const typedName = plainCustomerText(name || "");
  if (!typedName) return "";
  return state.salespeople.find((seller) => normalizeSearch(seller) === normalizeSearch(typedName)) || "";
}

function linkedCustomerSalesperson(customer) {
  if (!customer) return state.salespeople[0] || "";

  // 1) Primeiro respeita o vendedor salvo no cadastro do cliente.
  const customerSalesperson = normalizeSalespersonName(customer.salesperson);
  if (customerSalesperson) return customerSalesperson;

  // 2) Se o cliente não tiver vendedor cadastrado, aplica a regra por cidade/UF.
  const city = normalizeSearch(customerCityText(customer));
  const uf = normalizeSearch(customer.uf || customer.state || "");
  const address = normalizeSearch(customer.address || "");
  const rule = state.sellerCities.find((item) => {
    const cityMatches = city
      ? normalizeSearch(item.city) === city
      : address.includes(normalizeSearch(item.city));
    const ufMatches = !item.uf || !uf || normalizeSearch(item.uf) === uf || address.includes(normalizeSearch(item.uf));
    return cityMatches && ufMatches;
  });
  return normalizeSalespersonName(rule?.salesperson) || "";
}

function resolveCustomerSalesperson(customer) {
  return linkedCustomerSalesperson(customer) || state.salespeople[0] || "";
}

function currentSaleCustomerForSalesperson() {
  const documentValue = qs("#customer-document")?.value || "";
  const searchValue = qs("#customer-search")?.value || "";
  const nameValue = qs("#customer-name")?.value || "";
  const savedCustomer = findCustomer(documentValue)
    || findCustomerByTerm(searchValue)
    || findCustomerByTerm(nameValue);
  if (savedCustomer) return savedCustomer;
  return {
    document: cleanDocument(documentValue),
    name: nameValue,
    address: qs("#customer-address")?.value || "",
    phone: qs("#customer-phone")?.value || "",
    salesperson: ""
  };
}

function applySaleSalesperson(customer = null) {
  const salespersonSelect = qs('[name="salesperson"]');
  if (!salespersonSelect) return "";
  const sourceCustomer = customer || currentSaleCustomerForSalesperson();
  const linkedSalesperson = linkedCustomerSalesperson(sourceCustomer);
  const resolvedSalesperson = linkedSalesperson || state.salespeople[0] || "";

  // Garante que as opções existam antes de selecionar o vendedor.
  if (!salespersonSelect.options.length) {
    salespersonSelect.innerHTML = salespersonOptions(resolvedSalesperson);
  }

  const normalizedSalesperson = normalizeSalespersonName(resolvedSalesperson) || state.salespeople[0] || "";
  salespersonSelect.value = normalizedSalesperson;
  salespersonSelect.disabled = false;
  delete salespersonSelect.dataset.lockedValue;
  return normalizedSalesperson;
}

function paymentRuleLabel(rule) {
  if (!rule) return "";
  const typeLabel = rule.type === "customer" ? "Cliente" : rule.type === "seller" ? "Vendedor" : "Cidade";
  return `${typeLabel}: ${rule.reference}`;
}

function resolvePaymentRule(customer, salesperson) {
  if (!customer) return null;
  if (customer.payment && customer.paymentTerm) {
    return {
      id: `cliente-${customer.document}`,
      type: "customer",
      reference: customer.name,
      document: customer.document,
      payment: customer.payment,
      term: customer.paymentTerm
    };
  }
  const doc = cleanDocument(customer.document);
  const city = normalizeSearch(customerCityText(customer));
  return state.paymentRules.find((rule) => rule.type === "city" && normalizeSearch(rule.reference) === city)
    || state.paymentRules.find((rule) => rule.type === "seller" && normalizeSearch(rule.reference) === normalizeSearch(salesperson))
    || null;
}

function applyPaymentRuleForCustomer(customer) {
  const salesperson = linkedCustomerSalesperson(customer) || qs('[name="salesperson"]')?.value || state.salespeople[0] || "";
  const rule = resolvePaymentRule(customer, salesperson);
  const paymentSelect = qs('[name="payment"]');
  const paymentTermInput = qs("#sale-payment-term");
  if (!paymentSelect) return null;
  if (rule) {
    if (!state.paymentMethods.includes(rule.payment)) {
      state.paymentMethods.push(rule.payment);
      renderPaymentMethods();
    }
    paymentSelect.value = rule.payment;
    paymentSelect.disabled = false;
    paymentSelect.dataset.term = rule.term || "";
    paymentSelect.dataset.rule = paymentRuleLabel(rule);
    if (paymentTermInput) {
      paymentTermInput.value = rule.term || "";
      paymentTermInput.readOnly = false;
    }
    const status = qs("#sale-payment-rule-status");
    if (status) status.textContent = `Regra aplicada: ${paymentRuleLabel(rule)} | ${rule.payment} | prazo ${rule.term}`;
  } else {
    paymentSelect.disabled = false;
    paymentSelect.dataset.term = "";
    paymentSelect.dataset.rule = "";
    if (paymentTermInput) {
      paymentTermInput.value = "";
      paymentTermInput.readOnly = false;
    }
    const status = qs("#sale-payment-rule-status");
    if (status) status.textContent = "";
  }
  return rule;
}

function applyCurrentPaymentRule() {
  const customer = findCustomer(qs("#customer-document")?.value || "");
  applyPaymentRuleForCustomer(customer || {
    document: "",
    name: qs("#customer-name")?.value || "",
    address: qs("#customer-address")?.value || "",
    city: "",
    salesperson: ""
  });
}

function renderSellerCitiesSettings() {
  const sellerSelect = qs("#seller-city-salesperson");
  if (sellerSelect) sellerSelect.innerHTML = salespersonOptions(sellerSelect.value || state.salespeople[0] || "");
  const filterSelect = qs("#seller-city-filter");
  const currentFilter = filterSelect?.value || "";
  if (filterSelect) {
    filterSelect.innerHTML = [
      `<option value="">Todos os vendedores</option>`,
      ...state.salespeople.map((seller) => `<option value="${escapeAttr(seller)}" ${seller === currentFilter ? "selected" : ""}>${seller}</option>`)
    ].join("");
    filterSelect.value = state.salespeople.includes(currentFilter) ? currentFilter : "";
  }
  const filteredCities = state.sellerCities.filter((rule) => !filterSelect?.value || rule.salesperson === filterSelect.value);
  const count = qs("#seller-cities-count");
  if (count) count.textContent = `${filteredCities.length} cidades`;
  const table = qs("#seller-cities-table");
  if (!table) return;
  table.innerHTML = filteredCities.length ? filteredCities.map((rule) => `
    <tr>
      <td><input class="settings-input" data-seller-city-name="${rule.id}" value="${escapeAttr(rule.city)}" /></td>
      <td><input class="settings-input" data-seller-city-uf="${rule.id}" value="${escapeAttr(rule.uf || "")}" maxlength="2" /></td>
      <td><select data-seller-city-salesperson="${rule.id}">${salespersonOptions(rule.salesperson)}</select></td>
      <td class="right">
        <button class="stage-btn" type="button" data-save-seller-city="${rule.id}">Salvar</button>
        <button class="danger-btn" type="button" data-delete-seller-city="${rule.id}">Excluir</button>
      </td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="4" class="empty-row">Nenhuma cidade cadastrada.</td>
    </tr>
  `;
}

function accountOptions(selectedId = "") {
  return [
    `<option value="">Selecionar</option>`,
    ...state.financialAccounts.map((account) => `
      <option value="${account.id}" ${account.id === selectedId ? "selected" : ""}>${account.name}</option>
    `)
  ].join("");
}

function renderFinancialAccounts() {
  const total = state.financialAccounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const accountTotal = qs("#finance-account-total");
  if (accountTotal) accountTotal.textContent = money.format(total);
  const accountsCount = qs("#financial-accounts-count");
  if (accountsCount) accountsCount.textContent = `${state.financialAccounts.length} contas`;
  const accountsTable = qs("#financial-accounts-table");
  if (accountsTable) {
    accountsTable.innerHTML = state.financialAccounts.map((account) => `
      <tr>
        <td>${account.name}</td>
        <td class="right">${money.format(account.balance || 0)}</td>
      </tr>
    `).join("");
  }
  qs("#accounts-settings-count").textContent = `${state.financialAccounts.length} contas`;
  qs("#accounts-settings-table").innerHTML = state.financialAccounts.map((account) => `
    <tr>
      <td><input class="settings-input" data-account-name="${account.id}" value="${escapeAttr(account.name)}" /></td>
      <td class="right">${money.format(account.balance || 0)}</td>
      <td class="right">
        <button class="stage-btn" type="button" data-save-account="${account.id}">Salvar</button>
        <button class="danger-btn" type="button" data-delete-account="${account.id}">Excluir</button>
      </td>
    </tr>
  `).join("");
}

function formatQty(qty) {
  return `${qty.toLocaleString("pt-BR")} sacos`;
}

function normalizeLocation(value) {
  const normalized = normalizeSearch(value);
  return stockLocations.find((location) => normalizeSearch(location) === normalized) || "Divinopolis";
}

function normalizeStockLocationOrBlank(value) {
  const normalized = normalizeSearch(value);
  return stockLocations.find((location) => normalizeSearch(location) === normalized) || "";
}

function findStockLocationInText(value) {
  const normalized = normalizeSearch(value);
  if (!normalized) return "";
  return stockLocations.find((location) => normalized.includes(normalizeSearch(location))) || "";
}

function syncProductTotal(product) {
  product.locations = product.locations || makeEmptyLocations();
  stockLocations.forEach((location) => {
    const matchingKeys = Object.keys(product.locations).filter((key) => normalizeSearch(key) === normalizeSearch(location));
    product.locations[location] = matchingKeys.reduce((sum, key) => sum + Number(product.locations[key] || 0), 0);
  });
  Object.keys(product.locations).forEach((key) => {
    if (!stockLocations.some((location) => normalizeSearch(location) === normalizeSearch(key))) return;
    const cleanLocation = normalizeLocation(key);
    if (key !== cleanLocation) delete product.locations[key];
  });
  product.qty = stockLocations.reduce((sum, location) => sum + product.locations[location], 0);
}

function productAvailableQty(product, locationValue) {
  if (!product) return 0;
  syncProductTotal(product);
  return Number(product.locations?.[normalizeLocation(locationValue)] || 0);
}

function repairPendingOrderStockPostings() {
  let repaired = false;
  state.orders.forEach((order) => {
    if (order.directLoad || order.deliveryStatus === "Entregue" || !order.stockPosted) return;
    changeOrderItemsStock(order, 1, "Reparo de baixa pendente");
    order.stockPosted = false;
    repaired = true;
  });
  if (repaired) saveState();
}

function normalizeDirectLoadDeliveries() {
  let changed = false;
  state.orders.forEach((order) => {
    if (!order.directLoad) return;
    if (order.deliveryStatus !== "Entregue" || !order.stockPosted) {
      order.deliveryStatus = "Entregue";
      order.stockPosted = true;
      changed = true;
    }
  });
  if (changed) saveState();
}

function migrateLegacyEntryAllocations() {
  let changed = false;
  state.stockEntries.forEach((entry) => {
    if (entryAllocations(entry).length) return;
    const orderId = entry.generatedOrderId || entry.linkedOrderId;
    const order = orderId ? state.orders.find((item) => item.id === orderId) : null;
    if (!order?.directLoad) return;
    const oldLocation = stockLocations.includes(entry.location) ? entry.location : "";
    const product = findStockProductForEntry(entry);
    if (oldLocation && product) {
      changeProductLocationQty(product, oldLocation, -Number(entry.quantity || 0));
    }
    entry.location = "";
    entry.distributionStarted = true;
    entry.allocations.push({
      id: `ALOC-LEGADO-${order.id}`,
      type: "order",
      orderId: order.id,
      qty: Math.min(Number(order.qty || 0), Number(entry.quantity || 0))
    });
    updateInvoiceDistributionStatus(entry);
    changed = true;
  });
  if (changed) saveState();
}

function changeProductLocationQty(product, locationValue, quantity) {
  const location = normalizeLocation(locationValue);
  product.locations = product.locations || makeEmptyLocations();
  product.locations[location] = Number(product.locations[location] || 0) + quantity;
  syncProductTotal(product);
}

function renderNavigation() {
  qsa(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const user = getLoggedUser();
      if (user && !canAccessView(user, button.dataset.view)) {
        showToast("Acesso nao liberado para este usuario.");
        return;
      }
      qsa(".nav-item").forEach((item) => item.classList.remove("active"));
      qsa(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      qs(`#${button.dataset.view}`).classList.add("active");
      qs("#page-title").textContent = button.textContent;
      activeViewId = button.dataset.view;
      renderActiveView(activeViewId);
    });
  });
}

function forceOpenView(viewId, sourceButton = null) {
  const view = qs(`#${viewId}`);
  if (!view) return;
  const user = getLoggedUser();
  if (user && !canAccessView(user, viewId)) {
    showToast("Acesso nao liberado para este usuario.");
    return;
  }
  const button = sourceButton || qs(`.nav-item[data-view="${CSS.escape(viewId)}"]`);
  qsa(".nav-item").forEach((item) => item.classList.remove("active"));
  qsa(".view").forEach((item) => item.classList.remove("active"));
  button?.classList.add("active");
  view.classList.add("active");
  qs("#page-title").textContent = button?.textContent?.trim() || viewId;
  activeViewId = viewId;
  renderActiveView(viewId);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".nav-item[data-view]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  forceOpenView(button.dataset.view, button);
}, true);

function userPermissions(user) {
  return { ...defaultPermissions(), ...(user?.permissions || {}) };
}

function canAccessView(user, viewId) {
  return userPermissions(user)[viewId] !== false;
}

function applyUserPermissions(user) {
  const permissions = userPermissions(user);
  qsa(".nav-item").forEach((button) => {
    button.hidden = permissions[button.dataset.view] === false;
  });
  const activeButton = qs(".nav-item.active");
  if (activeButton && activeButton.hidden) {
    const nextButton = qsa(".nav-item").find((button) => !button.hidden);
    if (nextButton) nextButton.click();
  }
}

function statusClass(status) {
  if (["Recebido", "Importada", "Importada vinculada", "Normal", "Entregue"].includes(status)) return "ok";
  if (["Baixo", "Aberto", "Pedido", "Parcial"].includes(status)) return "warn";
  return "danger";
}

function renderDashboard() {
  const openSales = state.receivables.reduce((sum, item) => sum + receivableBalance(item), 0);
  const received = state.receivables.reduce((sum, item) => sum + Number(item.paidValue || 0), 0);
  const overdue = state.receivables.reduce((sum, item) => {
    const balance = receivableBalance(item);
    return balance > 0 && item.due && item.due < today ? sum + balance : sum;
  }, 0);

  qs("#finance-open").textContent = money.format(openSales);
  const financeOverdue = qs("#finance-overdue");
  if (financeOverdue) financeOverdue.textContent = money.format(overdue);
  const financePaid = qs("#finance-paid");
  if (financePaid) financePaid.textContent = money.format(received);

  renderDailyLoadBoard();
}

function isInvoiceStockEntry(entry) {
  const invoice = String(entry.invoice || "");
  return invoice && invoice !== "CADASTRO" && !invoice.startsWith("AJ-") && !invoice.startsWith("MAN-") && !invoice.startsWith("TR-");
}

function dailyLoadCardClass(load) {
  const isWarehouseOrder = Boolean(load?.isWarehouseOrder);
  const entry = dailyLoadPrimaryEntry(load);
  const noteEntries = load?.entries?.length ? load.entries : [entry];
  const allocations = noteEntries.flatMap((item) => entryAllocations(item));
  if (noteEntries.some((item) => item.distributionStarted && entryRemainingQuantity(item) > 0.009)) return "issue";
  if (allocations.some((allocation) => allocation.type === "order")) return "linked";
  if (allocations.some((allocation) => allocation.type === "stock")) return "stock";
  const linkedOrderId = entry.generatedOrderId || entry.linkedOrderId;
  const hasLocation = stockLocations.includes(entry.location);
  if (linkedOrderId) return "linked";
  if (isWarehouseOrder) return "stock";
  if (hasLocation) return "stock";
  return "issue";
}

function dailyLoadPrimaryEntry(load) {
  return load?.entries?.[0] || load;
}

function dailyLoadDriverKey(entry) {
  entry = dailyLoadPrimaryEntry(entry);
  return normalizeSearch(cleanDriverName(entry.loadedBy));
}

function dailyLoadDriverMatches(entry, driverName) {
  return dailyLoadDriverKey(entry).includes(normalizeSearch(driverName));
}

function assignDailyLoadEntry(slots, entry, preferredSlots, allowFallback = false) {
  const slotIndex = preferredSlots.find((index) => !slots[index]);
  if (slotIndex !== undefined) {
    slots[slotIndex] = entry;
    return true;
  }
  if (!allowFallback) return false;
  const fallbackIndex = slots.findIndex((slot) => !slot);
  if (fallbackIndex >= 0) {
    slots[fallbackIndex] = entry;
    return true;
  }
  return false;
}

function hasDailyLoadSlot(entry) {
  return entry.dailyLoadSlot !== "" && entry.dailyLoadSlot !== undefined && entry.dailyLoadSlot !== null;
}

function dailyLoadGroupId(entry) {
  if (entry.isWarehouseOrder) return entry.id;
  return [
    "nota",
    entry.invoice || "",
    normalizeSearch(entry.supplier || ""),
    cleanOvNumber(entry.factoryOrder) || normalizeSearch(entry.factoryOrder || ""),
    normalizeSearch(cleanDriverName(entry.loadedBy))
  ].join("|");
}

function dailyLoadDestinationLabels(load) {
  const entries = load?.entries?.length ? load.entries : [dailyLoadPrimaryEntry(load)];
  const allocations = entries.flatMap((entry) => entryAllocations(entry));
  if (allocations.length) {
    const labels = allocations.map((allocation) => {
      if (allocation.type === "stock") {
        return `Estoque ${allocation.location}: ${formatQty(allocation.qty)}`;
      }
      const order = state.orders.find((item) => item.id === allocation.orderId);
      return `${allocation.orderId || "Pedido"} ${order?.customer || "Cliente nao informado"}: ${formatQty(allocation.qty)}`;
    });
    const pending = entries.reduce((sum, entry) => sum + entryRemainingQuantity(entry), 0);
    if (pending > 0.009) labels.push(`Saldo sem destino: ${formatQty(pending)}`);
    return labels;
  }
  const entry = dailyLoadPrimaryEntry(load);
  const linkedOrderId = entry.generatedOrderId || entry.linkedOrderId;
  const order = linkedOrderId ? state.orders.find((item) => item.id === linkedOrderId) : null;
  if (order) return [`${order.id} ${order.customer}`];
  if (stockLocations.includes(entry.location)) return [`Estoque ${entry.location}`];
  return ["Sem destino"];
}

function isWarehouseLoadOrder(order) {
  return !order.directLoad
    && stockLocations.includes(order.stockLocation)
    && Boolean(cleanDriverName(order.driver));
}

function warehouseOrderPanelDate(order) {
  return order.panelDate || order.deliveryForecast || order.date;
}

function buildWarehouseOrderLoad(order) {
  const items = orderItems(order);
  return {
    id: `order-${order.id}`,
    isWarehouseOrder: true,
    orderId: order.id,
    entries: [],
    date: order.deliveryForecast || order.date,
    panelDate: order.panelDate,
    issueDateTime: order.deliveryForecast || order.date,
    importedAt: order.date,
    invoice: "",
    factoryOrder: order.id,
    product: orderItemsText(order),
    products: items.map((item) => `${item.product || "-"} (${formatQty(Number(item.qty || 0))})`),
    quantity: Number(order.qty || 0),
    loadedBy: order.driver,
    location: order.stockLocation,
    supplier: "Estoque da unidade",
    dailyLoadSlot: order.dailyLoadSlot
  };
}

function driverOptions() {
  return cleanDriverOptions([
    ...state.drivers,
    ...state.stockEntries.map((entry) => entry.loadedBy),
    ...state.notes.map((note) => note.loadedBy),
    ...state.orders.map((order) => order.driver)
  ]);
}

function driverSearchOptions(searchValue = "") {
  const search = normalizeSearch(searchValue);
  return driverOptions()
    .filter((driver) => !search || normalizeSearch(driver).includes(search))
    .slice(0, 10);
}

function renderDriverSearchOptions(searchValue = "") {
  const results = qs("#driver-search-results");
  if (!results) return;
  const drivers = driverSearchOptions(searchValue);
  if (!drivers.length) {
    results.hidden = true;
    results.innerHTML = "";
    return;
  }
  results.hidden = false;
  results.innerHTML = drivers.map((driver) => `
    <button class="customer-result-row" type="button" data-select-driver="${escapeAttr(driver)}">
      <strong>${driver}</strong>
    </button>
  `).join("");
}

function renderDriverOptions() {
  const options = driverOptions();
  const saleDriverSelect = qs("#sale-driver");
  if (saleDriverSelect) {
    const current = saleDriverSelect.value || "";
    const saleOptions = current && !options.includes(current) ? [current, ...options] : options;
    saleDriverSelect.innerHTML = [
      `<option value="">Selecione o motorista</option>`,
      ...saleOptions.map((name) => `<option value="${escapeAttr(name)}">${name}</option>`)
    ].join("");
    saleDriverSelect.value = saleOptions.includes(current) ? current : "";
  }
  const tripSelect = qs("#trip-report-driver");
  if (tripSelect) {
    const current = tripSelect.value || "";
    tripSelect.innerHTML = [
      `<option value="">Todos</option>`,
      ...options.map((name) => `<option value="${escapeAttr(name)}" ${name === current ? "selected" : ""}>${name}</option>`)
    ].join("");
    tripSelect.value = options.includes(current) ? current : "";
  }
}

function buildDailyLoadGroups(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const groupId = dailyLoadGroupId(entry);
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        id: groupId,
        entries: [],
        date: entry.date,
        panelDate: entry.panelDate,
        issueDateTime: entry.issueDateTime,
        importedAt: entry.importedAt,
        invoice: entry.invoice,
        factoryOrder: entry.factoryOrder,
        generatedOrderId: entry.generatedOrderId,
        linkedOrderId: entry.linkedOrderId,
        loadedBy: entry.loadedBy,
        location: entry.location,
        supplier: entry.supplier,
        dailyLoadSlot: entry.dailyLoadSlot
      });
    }
    groups.get(groupId).entries.push(entry);
  });
  return Array.from(groups.values()).map((group) => {
    const firstWithSlot = group.entries.find((entry) => hasDailyLoadSlot(entry));
    group.dailyLoadSlot = firstWithSlot?.dailyLoadSlot ?? group.dailyLoadSlot;
    group.products = group.entries.map((entry) => `${entry.product || "-"} (${formatQty(Number(entry.quantity || 0))})`);
    group.quantity = group.entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
    return group;
  });
}

function organizeDailyLoadSlots(entries) {
  const slots = Array.from({ length: 24 }, () => null);
  const sortedEntries = [...entries].sort((a, b) => {
    const firstDate = String(a.issueDateTime || a.date || a.importedAt || "");
    const secondDate = String(b.issueDateTime || b.date || b.importedAt || "");
    const dateOrder = firstDate.localeCompare(secondDate);
    if (dateOrder !== 0) return dateOrder;
    return String(a.invoice || a.id || "").localeCompare(String(b.invoice || b.id || ""));
  });
  const fixedDrivers = [
    { name: "hailton", slots: [0, 4] },
    { name: "reginaldo", slots: [1, 5] },
    { name: "antonio", slots: [2, 6] },
    { name: "daniel", slots: [3, 7] },
    { name: "vicente", slots: [8] },
    { name: "agnaldo", slots: [10] },
    { name: "alison", slots: [11] },
    { name: "doralicio", slots: [12] },
    { name: "nelio", slots: [13] },
    { name: "sergio", slots: [14] },
    { name: "rander", slots: [15] }
  ];
  const usedEntries = new Set();

  sortedEntries
    .filter((entry) => hasDailyLoadSlot(entry) && Number.isInteger(Number(entry.dailyLoadSlot)) && Number(entry.dailyLoadSlot) >= 0 && Number(entry.dailyLoadSlot) < slots.length)
    .forEach((entry) => {
      const slotIndex = Number(entry.dailyLoadSlot);
      if (!slots[slotIndex]) {
        slots[slotIndex] = entry;
        usedEntries.add(entry);
      }
    });

  fixedDrivers.forEach((driver) => {
    sortedEntries
      .filter((entry) => !usedEntries.has(entry) && dailyLoadDriverMatches(entry, driver.name))
      .forEach((entry) => {
        if (assignDailyLoadEntry(slots, entry, driver.slots, false)) usedEntries.add(entry);
      });
  });

  sortedEntries
    .filter((entry) => !usedEntries.has(entry))
    .forEach((entry) => {
      if (assignDailyLoadEntry(slots, entry, [18, 19], false)) usedEntries.add(entry);
    });

  return slots;
}

function dashboardDateNumber(dateValue) {
  const parts = String(dateValue || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return NaN;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000;
}

function datePartsFromIso(dateValue) {
  const parts = String(dateValue || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function isoFromUtcDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function easterSundayIso(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDaysIso(dateValue, days) {
  const parts = datePartsFromIso(dateValue);
  if (!parts) return "";
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return isoFromUtcDate(date);
}

function nationalHolidaySet(year) {
  const easter = easterSundayIso(year);
  return new Set([
    `${year}-01-01`,
    `${year}-04-21`,
    `${year}-05-01`,
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-11-20`,
    `${year}-12-25`,
    addDaysIso(easter, -2)
  ]);
}

function isBusinessDay(dateValue) {
  const parts = datePartsFromIso(dateValue);
  if (!parts) return false;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  return !nationalHolidaySet(parts.year).has(isoFromUtcDate(date));
}

function businessDaysAfter(startDateValue, endDateValue) {
  let current = addDaysIso(startDateValue, 1);
  const endNumber = dashboardDateNumber(endDateValue);
  if (!current || !Number.isFinite(endNumber)) return NaN;
  let count = 0;
  while (dashboardDateNumber(current) <= endNumber) {
    if (isBusinessDay(current)) count += 1;
    current = addDaysIso(current, 1);
  }
  return count;
}

function dashboardDateLockInfo(dateValue) {
  const date = String(dateValue || today);
  const override = state.dashboardLockOverrides?.[date];
  if (typeof override === "boolean") {
    return {
      locked: override,
      source: override ? "manual" : "manual-unlock"
    };
  }
  const age = businessDaysAfter(date, today);
  const shouldLock = Number.isFinite(age) && age >= 2;
  return {
    locked: shouldLock,
    source: shouldLock ? "automatic" : "open"
  };
}

function isDashboardDateLocked(dateValue) {
  return dashboardDateLockInfo(dateValue).locked;
}

function renderDashboardLockSettings() {
  const dateInput = qs("#dashboard-lock-date");
  const button = qs("#dashboard-config-lock-btn");
  const status = qs("#dashboard-lock-status");
  if (!dateInput || !button || !status) return;
  if (!dateInput.value) dateInput.value = today;
  const info = dashboardDateLockInfo(dateInput.value);
  status.textContent = info.source === "automatic"
    ? "Travado automaticamente"
    : info.source === "manual"
      ? "Travado manualmente"
      : info.source === "manual-unlock"
        ? "Destravado manualmente"
        : "Destravado";
  button.textContent = info.locked ? "Destravar painel" : "Travar painel";
  button.classList.toggle("active", info.locked);
  button.setAttribute("aria-pressed", String(info.locked));
}

function toggleDashboardDateLock() {
  const dateInput = qs("#dashboard-lock-date");
  const date = dateInput?.value || today;
  const nextLocked = !isDashboardDateLocked(date);
  if (!state.dashboardLockOverrides || typeof state.dashboardLockOverrides !== "object") {
    state.dashboardLockOverrides = {};
  }
  state.dashboardLockOverrides[date] = nextLocked;
  saveState();
  renderDashboardLockSettings();
  renderDailyLoadBoard();
  showToast(nextLocked ? "Painel da data travado." : "Painel da data destravado.");
}

function isStockDateLocked(dateValue) {
  const lockDate = String(state.stockLockDate || "");
  const date = String(dateValue || today);
  return Boolean(lockDate && date && date <= lockDate);
}

function assertStockDateUnlocked(dateValue, actionText = "alterar o estoque") {
  if (!isStockDateLocked(dateValue)) return true;
  showToast(`Estoque travado ate ${formatDateBR(state.stockLockDate)}. Nao e possivel ${actionText} nessa data.`);
  return false;
}

function renderStockLockSettings() {
  const input = qs("#stock-lock-date");
  const status = qs("#stock-lock-status");
  const clearButton = qs("#clear-stock-lock-btn");
  if (!input || !status) return;
  if (!input.value) input.value = state.stockLockDate || today;
  status.textContent = state.stockLockDate
    ? `Travado ate ${formatDateBR(state.stockLockDate)}`
    : "Destravado";
  if (clearButton) clearButton.disabled = !state.stockLockDate;
}

function saveStockLockDate() {
  const input = qs("#stock-lock-date");
  const date = input?.value || "";
  if (!date) {
    showToast("Informe uma data para travar o estoque.");
    return;
  }
  state.stockLockDate = date;
  saveState();
  saveStateToCloudNow();
  renderStockLockSettings();
  showToast(`Estoque travado ate ${formatDateBR(date)}.`);
}

function clearStockLockDate() {
  state.stockLockDate = "";
  const input = qs("#stock-lock-date");
  if (input) input.value = today;
  saveState();
  saveStateToCloudNow();
  renderStockLockSettings();
  showToast("Trava de estoque removida.");
}

function unresolvedLoadDates() {
  const groups = buildDailyLoadGroups(state.stockEntries.filter(isInvoiceStockEntry));
  return Array.from(new Set(groups
    .filter((load) => dailyLoadCardClass(load) === "issue")
    .map((load) => {
      const entry = dailyLoadPrimaryEntry(load);
      return entry.panelDate || entry.date || "";
    })
    .filter((date) => date && date < today)))
    .sort();
}

function renderDailyLoadAlert(selectedDate) {
  const alert = qs("#daily-load-alert");
  if (!alert) return;
  const dates = selectedDate === today ? unresolvedLoadDates() : [];
  alert.hidden = !dates.length;
  alert.textContent = dates.length
    ? `CARGA SEM DESTINO: ${dates.map((date) => date.split("-").reverse().join("/")).join(", ")}`
    : "";
}

function renderDailyLoadBoard() {
  const dateInput = qs("#daily-load-date");
  if (!dateInput) return;
  if (!dateInput.value) dateInput.value = today;
  const locked = isDashboardDateLocked(dateInput.value);
  qs("#daily-load-grid")?.classList.toggle("locked", locked);
  renderDailyLoadAlert(dateInput.value);

  const entries = state.stockEntries
    .filter((entry) => isInvoiceStockEntry(entry) && (entry.panelDate || entry.date) === dateInput.value)
  const warehouseOrders = state.orders
    .filter((order) => isWarehouseLoadOrder(order) && warehouseOrderPanelDate(order) === dateInput.value)
    .map(buildWarehouseOrderLoad);
  const groups = [...buildDailyLoadGroups(entries), ...warehouseOrders].slice(0, 24);

  qs("#daily-load-count").textContent = `${groups.length} cargas`;
  const slots = organizeDailyLoadSlots(groups);
  qs("#daily-load-grid").innerHTML = slots.map((load, index) => {
    if (!load) {
      return `
        <article class="load-card empty" data-load-slot="${index}">
          <strong>Carga ${String(index + 1).padStart(2, "0")}</strong>
          <span>Vazio</span>
        </article>
      `;
    }

    const entry = dailyLoadPrimaryEntry(load);
    const order = load.isWarehouseOrder ? state.orders.find((item) => item.id === load.orderId) : null;
    const customerLabel = load.isWarehouseOrder && order
      ? `${order.id} ${order.customer}`
      : dailyLoadDestinationLabels(load).join("<br>");
    return `
      <article class="load-card ${dailyLoadCardClass(load)}" draggable="${locked ? "false" : "true"}" data-load-entry="${load.id}" data-load-slot="${index}">
        <div class="load-card-head">
          <strong>Carga ${String(index + 1).padStart(2, "0")}</strong>
          <span>${load.isWarehouseOrder ? `Estoque ${entry.location}` : `NF ${entry.invoice || "-"}`}</span>
        </div>
        <dl>
          <div><dt>Data</dt><dd>${entry.date.split("-").reverse().join("/")}</dd></div>
          <div><dt>Data painel</dt><dd><input class="load-date-input" type="date" value="${entry.panelDate || entry.date}" data-load-panel-date="${load.id}" ${locked ? "disabled" : ""} /></dd></div>
          <div><dt>Pedido fabrica</dt><dd>${cleanOvNumber(entry.factoryOrder) || entry.factoryOrder || "-"}</dd></div>
          <div><dt>Produto</dt><dd>${load.products?.join("<br>") || entry.product || "-"}</dd></div>
          <div><dt>Qtd.</dt><dd>${formatQty(load.quantity || entry.quantity)}</dd></div>
          <div><dt>Motorista</dt><dd>${cleanDriverName(entry.loadedBy) || "Nao informado"}</dd></div>
          <div><dt>Cliente/Pedido</dt><dd>${customerLabel}</dd></div>
        </dl>
      </article>
    `;
  }).join("");
}

function updateDailyLoadPanelDate(entryId, panelDate) {
  const currentPanelDate = qs("#daily-load-date")?.value || today;
  if (isDashboardDateLocked(currentPanelDate) || isDashboardDateLocked(panelDate)) {
    showToast("Painel travado. Destrave para alterar.");
    renderDailyLoadBoard();
    return;
  }
  if (entryId.startsWith("order-")) {
    const order = state.orders.find((item) => `order-${item.id}` === entryId);
    if (!order || !panelDate) return;
    order.panelDate = panelDate;
    order.dailyLoadSlot = "";
    saveState();
    renderAll();
    showToast("Data do painel alterada.");
    return;
  }
  const entries = state.stockEntries.filter((item) => dailyLoadGroupId(item) === entryId || item.id === entryId);
  if (!entries.length || !panelDate) return;
  entries.forEach((entry) => {
    entry.panelDate = panelDate;
    entry.dailyLoadSlot = "";
  });
  saveState();
  renderAll();
  showToast("Data do painel alterada.");
}

function moveDailyLoadEntry(entryId, slotIndex) {
  const selectedPanelDate = qs("#daily-load-date")?.value || today;
  if (isDashboardDateLocked(selectedPanelDate)) {
    showToast("Painel travado. Destrave para alterar.");
    return;
  }
  const orderLoad = entryId.startsWith("order-")
    ? state.orders.find((item) => `order-${item.id}` === entryId)
    : null;
  const entries = state.stockEntries.filter((item) => dailyLoadGroupId(item) === entryId || item.id === entryId);
  if (!entries.length && !orderLoad) return;
  const targetSlot = Number(slotIndex);
  if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot > 23) return;
  const currentPanelDate = selectedPanelDate;
  const previousSlot = orderLoad?.dailyLoadSlot || entries.find((entry) => hasDailyLoadSlot(entry))?.dailyLoadSlot || "";
  const displacedGroupId = state.stockEntries.find((item) => {
    return !entries.includes(item)
      && isInvoiceStockEntry(item)
      && (item.panelDate || item.date) === currentPanelDate
      && Number(item.dailyLoadSlot) === targetSlot;
  }) ? dailyLoadGroupId(state.stockEntries.find((item) => {
    return !entries.includes(item)
      && isInvoiceStockEntry(item)
      && (item.panelDate || item.date) === currentPanelDate
      && Number(item.dailyLoadSlot) === targetSlot;
  })) : "";
  if (displacedGroupId) {
    state.stockEntries
      .filter((item) => dailyLoadGroupId(item) === displacedGroupId)
      .forEach((item) => {
        item.dailyLoadSlot = previousSlot;
      });
  }
  const displacedOrder = state.orders.find((order) => {
    return order !== orderLoad
      && isWarehouseLoadOrder(order)
      && warehouseOrderPanelDate(order) === currentPanelDate
      && Number(order.dailyLoadSlot) === targetSlot;
  });
  if (displacedOrder) displacedOrder.dailyLoadSlot = previousSlot;
  if (orderLoad) {
    orderLoad.panelDate = currentPanelDate;
    orderLoad.dailyLoadSlot = targetSlot;
  }
  entries.forEach((entry) => {
    entry.panelDate = currentPanelDate;
    entry.dailyLoadSlot = targetSlot;
  });
  saveState();
  renderAll();
}

function renderStock() {
  const term = qs("#stock-search").value.trim().toLowerCase();
  const locationFilter = qs("#stock-location-filter").value;
  const stockBody = qs("#stock-table");
  const stockHeader = stockBody.closest("table")?.querySelector("thead tr");
  const rows = state.stock.filter((item) => {
    const balance = syncProductBalanceFromLedger(item);
    const matchesTerm = [item.product, item.factory, item.batch].some((field) => field.toLowerCase().includes(term));
    const matchesLocation = !locationFilter || Number(balance[locationFilter] || 0) > 0;
    return matchesTerm && matchesLocation;
  });

  if (stockHeader) {
    stockHeader.innerHTML = locationFilter ? `
      <th>Produto</th>
      <th>Fabrica</th>
      <th class="right">${locationFilter}</th>
      <th></th>
    ` : `
      <th>Produto</th>
      <th>Fabrica</th>
      <th class="right">Divinopolis</th>
      <th class="right">Arcos</th>
      <th class="right">Total</th>
      <th></th>
    `;
  }

  stockBody.innerHTML = rows.map((item) => {
    const balance = syncProductBalanceFromLedger(item);
    const selectedQty = locationFilter ? Number(balance[locationFilter] || 0) : balance.total;
    if (locationFilter) {
      return `
        <tr>
          <td><strong>${item.product}</strong></td>
          <td>${item.factory}</td>
          <td class="right">${formatQty(selectedQty)}</td>
          <td class="right"><button class="stock-detail-btn" type="button" data-stock-ledger="${item.id}">Detalhar</button></td>
        </tr>
      `;
    }

    return `
      <tr>
        <td><strong>${item.product}</strong></td>
        <td>${item.factory}</td>
        <td class="right">${formatQty(balance.Divinopolis)}</td>
        <td class="right">${formatQty(balance.Arcos)}</td>
        <td class="right">${formatQty(balance.total)}</td>
        <td class="right"><button class="stock-detail-btn" type="button" data-stock-ledger="${item.id}">Detalhar</button></td>
      </tr>
    `;
  }).join("");

  if (!selectedStockProductId && state.stock.length) {
    selectedStockProductId = state.stock[0].id;
  }

  renderSaleProductOptions();
  renderStockLedger(selectedStockProductId);
  renderStockEntries();
  applyLastPrice();
}

function renderSaleProductOptions() {
  const productSelect = qs("#sale-product");
  if (!productSelect) return;
  const saleLocation = normalizeLocation(qs("#sale-stock-location")?.value || "Divinopolis");
  const previousValue = productSelect.value;
  const lockedValue = saleLockedProductId(previousValue);
  productSelect.innerHTML = state.stock.length ? state.stock.map((item) => {
    const balance = syncProductBalanceFromLedger(item);
    return `<option value="${item.id}">${item.product} - ${saleLocation}: ${formatQty(balance[saleLocation] || 0)}</option>`;
  }).join("") : `<option value="">Nenhum produto cadastrado</option>`;
  const desiredValue = productSelect.disabled && lockedValue ? lockedValue : previousValue;
  if (desiredValue && Array.from(productSelect.options).some((option) => option.value === desiredValue)) {
    productSelect.value = desiredValue;
  }
  if (qs("#sale-extra-items-table")) {
    syncSaleExtraItemDrafts();
    renderSaleExtraItems();
  }
}

function saleProductOptionsHtml(selectedId = "") {
  const saleLocation = normalizeLocation(qs("#sale-stock-location")?.value || "Divinopolis");
  return state.stock.length ? state.stock.map((item) => {
    const balance = syncProductBalanceFromLedger(item);
    const selected = item.id === selectedId ? "selected" : "";
    return `<option value="${item.id}" ${selected}>${escapeHtml(item.product)} - ${saleLocation}: ${formatQty(balance[saleLocation] || 0)}</option>`;
  }).join("") : `<option value="">Nenhum produto cadastrado</option>`;
}

function syncSaleExtraItemDrafts() {
  saleExtraItemDrafts = qsa("#sale-extra-items-table tr").map((row) => ({
    id: row.dataset.saleExtraItem || `EXTRA-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    productId: row.querySelector("[data-extra-product]")?.value || "",
    qty: Number(row.querySelector("[data-extra-qty]")?.value || 0),
    price: Number(row.querySelector("[data-extra-price]")?.value || 0)
  }));
}

function renderSaleExtraItems() {
  const table = qs("#sale-extra-items-table");
  if (!table) return;
  table.innerHTML = saleExtraItemDrafts.map((item) => `
    <tr data-sale-extra-item="${escapeAttr(item.id)}">
      <td>
        <select data-extra-product>${saleProductOptionsHtml(item.productId)}</select>
      </td>
      <td><input data-extra-qty type="number" min="1" value="${item.qty || 1}" /></td>
      <td><input data-extra-price type="number" min="0.01" step="0.01" value="${Number(item.price || 38.9).toFixed(2)}" /></td>
      <td class="right"><button class="danger-btn" type="button" data-remove-sale-extra-item="${escapeAttr(item.id)}">Excluir</button></td>
    </tr>
  `).join("");
  updateSaleTotalPreview();
}

function calculateSaleFormTotal() {
  const quantity = Number(qs('[name="quantity"]')?.value || 0);
  const price = parseMoneyInput(qs('[name="price"]')?.value || "");
  let total = quantity * price;
  qsa("#sale-extra-items-table tr").forEach((row) => {
    const qty = Number(row.querySelector("[data-extra-qty]")?.value || 0);
    const unitPrice = parseMoneyInput(row.querySelector("[data-extra-price]")?.value || "");
    total += qty * unitPrice;
  });
  return Number.isFinite(total) ? total : 0;
}

function updateSaleTotalPreview() {
  const target = qs("#sale-total-preview");
  if (!target) return;
  target.textContent = money.format(calculateSaleFormTotal());
}

function addSaleExtraItem(item = {}) {
  syncSaleExtraItemDrafts();
  saleExtraItemDrafts.push({
    id: item.id || `EXTRA-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    productId: item.productId || state.stock[0]?.id || "",
    qty: Number(item.qty || 1),
    price: Number(item.price || 38.9)
  });
  renderSaleExtraItems();
}

function setSaleExtraItems(items = []) {
  saleExtraItemDrafts = items.map((item, index) => ({
    id: item.id || `EXTRA-${Date.now()}-${index}`,
    productId: item.productId || "",
    qty: Number(item.qty || 1),
    price: Number(item.price || 38.9)
  }));
  renderSaleExtraItems();
}

function setSaleExtraItemsVisible(visible = true) {
  const panel = qs("#sale-extra-items-panel");
  if (panel) panel.hidden = !visible;
}

function orderItems(order) {
  if (Array.isArray(order?.items) && order.items.length) return order.items;
  if (Array.isArray(order?.directLoadItems) && order.directLoadItems.length) {
    return order.directLoadItems.map((item) => ({
      productId: item.productId || "",
      product: item.product,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      value: Number(item.value || 0),
      stockLocation: order.stockLocation || ""
    }));
  }
  return [{
    productId: order?.productId || "",
    product: order?.product || "",
    qty: Number(order?.qty || 0),
    price: Number(order?.price || 0),
    value: Number(order?.value || 0),
    stockLocation: order?.stockLocation || ""
  }];
}

function orderItemsText(order) {
  return orderItems(order)
    .map((item) => `${item.product || "-"} (${formatQty(item.qty)})`)
    .join(" / ");
}

function orderItemsHtml(order) {
  return orderItems(order)
    .map((item) => `${escapeHtml(item.product || "-")} <small>${formatQty(item.qty)}</small>`)
    .join("<br>");
}

function buildStandardOrderItems(mainProduct, mainQty, mainPrice, stockLocation) {
  syncSaleExtraItemDrafts();
  const items = [{
    productId: mainProduct.id,
    product: mainProduct.product,
    qty: Number(mainQty || 0),
    price: Number(mainPrice || 0),
    stockLocation
  }];
  saleExtraItemDrafts.forEach((draft) => {
    const product = state.stock.find((item) => item.id === draft.productId);
    if (!product) return;
    items.push({
      productId: product.id,
      product: product.product,
      qty: Number(draft.qty || 0),
      price: Number(draft.price || 0),
      stockLocation
    });
  });
  return items.map((item) => ({
    ...item,
    value: Number(item.qty || 0) * Number(item.price || 0)
  }));
}

function findStockProductForOrderItem(item) {
  return state.stock.find((product) => product.id === item.productId)
    || findStockProductByName(item.product);
}

function findStockProductForEntry(entry) {
  if (!entry) return null;
  return state.stock.find((product) => product.id === entry.productId)
    || findStockProductByName(entry.product);
}

function saleLockedProductId(fallbackId = "") {
  const directEntryId = sourceEntryForOrderId || sourceEntryGroupForOrderIds[0] || "";
  const directEntry = directEntryId ? state.stockEntries.find((entry) => entry.id === directEntryId) : null;
  const directProduct = findStockProductForEntry(directEntry);
  if (directProduct?.id) return directProduct.id;

  const editingOrder = editingOrderId ? state.orders.find((order) => order.id === editingOrderId) : null;
  if (editingOrder?.directLoad || editingOrder?.sourceEntryId) {
    const editingEntry = editingOrder.sourceEntryId
      ? state.stockEntries.find((entry) => entry.id === editingOrder.sourceEntryId)
      : null;
    const editingProduct = findStockProductForEntry(editingEntry);
    return editingProduct?.id || editingOrder.productId || fallbackId;
  }

  return fallbackId;
}

function hasStockForOrderItems(items, location) {
  const requestedByProduct = new Map();
  items.forEach((item) => {
    const product = findStockProductForOrderItem(item);
    if (!product) {
      requestedByProduct.set(`missing:${item.product}`, { product, qty: Number(item.qty || 0), name: item.product || "produto" });
      return;
    }
    const current = requestedByProduct.get(product.id) || { product, qty: 0, name: product.product };
    current.qty += Number(item.qty || 0);
    requestedByProduct.set(product.id, current);
  });
  for (const item of requestedByProduct.values()) {
    const availableQty = productAvailableQty(item.product, location);
    if (!item.product || availableQty < item.qty) {
      return { ok: false, product: item.name, availableQty };
    }
  }
  return { ok: true };
}

function changeOrderItemsStock(order, multiplier, movementLabel) {
  const location = normalizeLocation(order.stockLocation);
  orderItems(order).forEach((item) => {
    const product = findStockProductForOrderItem(item);
    if (!product) return;
    const quantity = Number(item.qty || 0) * multiplier;
    changeProductLocationQty(product, location, quantity);
    state.movements.unshift({
      date: orderStockDate(order),
      op: `${movementLabel} ${location}`,
      product: product.product,
      qty: quantity
    });
  });
}

function renderStockAdjustmentOptions() {
  const adjustmentOptions = state.stock.length ? state.stock.map((item) => {
    syncProductTotal(item);
    return `<option value="${item.id}">${item.product} - Total: ${formatQty(item.qty)}</option>`;
  }).join("") : `<option value="">Nenhum produto cadastrado</option>`;
  const manualOptions = state.stock.length
    ? state.stock.map((item) => `<option value="${item.id}">${item.product}</option>`).join("")
    : `<option value="">Nenhum produto cadastrado</option>`;
  const adjustmentSelect = qs("#adjust-stock-product");
  const manualSelect = qs("#manual-stock-product");
  if (adjustmentSelect) adjustmentSelect.innerHTML = adjustmentOptions;
  if (manualSelect) manualSelect.innerHTML = manualOptions;
  const originSelect = qs("#adjust-stock-origin");
  const destinationSelect = qs("#adjust-stock-destination");
  if (originSelect && destinationSelect && originSelect.value === destinationSelect.value) {
    destinationSelect.value = originSelect.value === "Divinopolis" ? "Arcos" : "Divinopolis";
  }
}

function renderManualStockSettings() {
  const entries = state.stockEntries
    .filter((entry) => entry.movementType)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  const count = qs("#manual-stock-count");
  const table = qs("#manual-stock-settings-table");
  if (count) count.textContent = `${entries.length} lançamentos`;
  if (!table) return;
  table.innerHTML = entries.length ? entries.map((entry) => {
    const typeLabel = entry.movementType === "entrada" ? "Entrada" : entry.movementType === "saida" ? "Saida" : "Ajuste de saldo";
    const displayedQuantity = entry.movementType === "ajuste"
      ? Number(entry.requestedQuantity ?? Math.abs(Number(entry.quantity || 0)))
      : Math.abs(Number(entry.quantity || 0));
    return `
      <tr>
        <td>${formatDateBR(entry.date)}</td>
        <td><strong>${entry.product || "-"}</strong></td>
        <td>${normalizeLocation(entry.location)}</td>
        <td>${typeLabel}</td>
        <td class="right">${formatQty(displayedQuantity)}</td>
        <td>${entry.supplier || "-"}</td>
        <td class="right"><button class="danger-btn" type="button" data-delete-manual-stock="${entry.id}">Excluir</button></td>
      </tr>
    `;
  }).join("") : `
    <tr><td colspan="7" class="center muted">Nenhum lançamento manual cadastrado.</td></tr>
  `;
}

function buildStockLedger(productId, locationOverride) {
  const product = state.stock.find((item) => item.id === productId);
  if (!product) return { product: null, rows: [], entries: 0, exits: 0, balance: 0 };
  const selectedLocation = locationOverride !== undefined
    ? locationOverride
    : qs("#stock-location-filter")?.value || "";

  const entries = state.stockEntries
    .filter((entry) => {
      const sameProductId = entry.productId && entry.productId === product.id;
      const sameProductNameMatch = sameProductName(entry.product, product.product);
      return sameProductId || sameProductNameMatch;
    })
    .flatMap((entry) => {
      if (entry.distributionStarted) {
        return entryAllocations(entry)
          .filter((allocation) => {
            if (allocation.type !== "stock") return false;
            const allocationLocation = normalizeStockLocationOrBlank(allocation.location);
            return allocationLocation && (!selectedLocation || allocationLocation === selectedLocation);
          })
          .map((allocation) => {
            const allocationLocation = normalizeStockLocationOrBlank(allocation.location);
            return {
              date: entry.date,
              type: "Entrada distribuida",
              document: entry.invoice,
              party: `${entry.supplier || entry.loadedBy || "-"} / ${allocationLocation}`,
              location: allocationLocation,
              sourceEntryId: entry.id,
              allocationId: allocation.id,
              canReverseStockAllocation: true,
              manualEntryId: "",
              isManualMovement: false,
              entry: Number(allocation.qty || 0),
              exit: 0
            };
          });
      }
      const quantity = Number(entry.quantity || 0);
      const location = normalizeStockLocationOrBlank(entry.location);
      if (!location) return [];
      if (selectedLocation && location !== selectedLocation) return [];
      const isTransferEntry = String(entry.invoice || "").startsWith("TR-")
        && (normalizeSearch(entry.supplier).includes("origem")
          || normalizeSearch(entry.supplier).includes("destino"));
      return [{
        date: entry.date,
        type: entry.movementType === "entrada"
          ? "Entrada manual"
          : entry.movementType === "saida"
            ? "Saida manual"
            : entry.movementType === "ajuste"
              ? "Ajuste manual"
              : isTransferEntry
                ? (quantity < 0 ? "Transferencia saida" : "Transferencia entrada")
                : quantity < 0 ? "Ajuste de saida" : "Entrada",
        document: entry.invoice,
        party: `${entry.supplier || entry.loadedBy || "-"} / ${location}`,
        location,
        sourceEntryId: entry.id,
        canReverseStockEntry: isInvoiceStockEntry(entry) && quantity > 0 && stockLocations.includes(normalizeStockLocationOrBlank(entry.location)),
        canReverseStockTransfer: isTransferEntry,
        transferDocument: entry.invoice,
        manualEntryId: entry.movementType ? entry.id : "",
        isManualMovement: Boolean(entry.movementType),
        entry: quantity > 0 ? quantity : 0,
        exit: quantity < 0 ? Math.abs(quantity) : 0
      }];
    });

  const exits = state.orders
    .filter((order) => order.deliveryStatus === "Entregue" && order.stockPosted && !order.directLoad)
    .flatMap((order) => orderItems(order)
      .filter((item) => item.productId === productId || sameProductName(item.product, product.product))
      .filter((item) => !selectedLocation || normalizeLocation(item.stockLocation || order.stockLocation) === selectedLocation)
      .map((item) => {
        const location = normalizeLocation(item.stockLocation || order.stockLocation);
        return {
          date: orderStockDate(order),
          type: "Pedido entregue",
          document: order.id,
          party: `${order.customer} / ${location}`,
          location,
          entry: 0,
          exit: Number(item.qty || 0)
        };
      }));

  const rows = [...entries, ...exits].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.type.localeCompare(b.type);
  });

  let balance = 0;
  rows.forEach((row) => {
    balance += row.entry - row.exit;
    row.balance = balance;
  });

  return {
    product,
    rows,
    entries: entries.reduce((sum, row) => sum + row.entry, 0),
    exits: exits.reduce((sum, row) => sum + row.exit, 0),
    balance,
    selectedLocation
  };
}

function syncProductBalanceFromLedger(product) {
  if (!product) return { Divinopolis: 0, Arcos: 0, total: 0 };
  product.locations = product.locations || makeEmptyLocations();
  const balances = stockLocations.reduce((result, location) => {
    result[location] = buildStockLedger(product.id, location).balance;
    return result;
  }, {});
  stockLocations.forEach((location) => {
    product.locations[location] = balances[location];
  });
  product.qty = stockLocations.reduce((sum, location) => sum + Number(product.locations[location] || 0), 0);
  return {
    Divinopolis: Number(product.locations.Divinopolis || 0),
    Arcos: Number(product.locations.Arcos || 0),
    total: Number(product.qty || 0)
  };
}

function renderStockLedger(productId) {
  const ledger = buildStockLedger(productId);
  if (!ledger.product) {
    qs("#stock-ledger-title").textContent = "Composicao do saldo";
    qs("#stock-ledger-balance").textContent = "Selecione um produto";
    qs("#stock-ledger-table").innerHTML = "";
    return;
  }

  const locationLabel = ledger.selectedLocation || "Todas as unidades";
  qs("#stock-ledger-title").textContent = `Composicao do saldo - ${ledger.product.product} - ${locationLabel}`;
  const ledgerDateInput = qs("#stock-ledger-date-filter");
  if (ledgerDateInput && !ledgerDateInput.value) ledgerDateInput.value = today;
  const filterDate = ledgerDateInput?.value || today;
  const rows = filterDate ? ledger.rows.filter((row) => row.date === filterDate) : ledger.rows;
  const previousBalance = filterDate
    ? ledger.rows
      .filter((row) => row.date < filterDate)
      .reduce((sum, row) => sum + row.entry - row.exit, 0)
    : 0;
  const finalBalance = filterDate
    ? previousBalance + rows.reduce((sum, row) => sum + row.entry - row.exit, 0)
    : ledger.balance;
  const displayRows = [
    {
      date: filterDate || (rows[0]?.date || today),
      type: "Saldo anterior",
      document: "-",
      party: "-",
      entry: 0,
      exit: 0,
      balance: previousBalance
    },
    ...rows,
    {
      date: filterDate || (rows[rows.length - 1]?.date || today),
      type: "Saldo final",
      document: "-",
      party: "-",
      entry: 0,
      exit: 0,
      balance: finalBalance
    }
  ];
  qs("#stock-ledger-balance").textContent = filterDate
    ? `Saldo anterior ${formatQty(previousBalance)} | Saldo final ${formatQty(finalBalance)} | ${rows.length} movimentações`
    : `Unidade ${locationLabel} | Entradas ${formatQty(ledger.entries)} | Saidas ${formatQty(ledger.exits)} | Saldo calculado ${formatQty(ledger.balance)}`;
  qs("#stock-ledger-table").innerHTML = displayRows.length ? displayRows.map((row) => `
    <tr class="${row.isManualMovement ? "manual-adjustment-row" : ""}">
      <td>${row.date.split("-").reverse().join("/")}</td>
      <td>${row.type}</td>
      <td>${stockLedgerDocumentCell(row)}</td>
      <td>${row.party || "-"}</td>
      <td class="right">${row.entry ? formatQty(row.entry) : "-"}</td>
      <td class="right">${row.exit ? formatQty(row.exit) : "-"}</td>
      <td class="right">${formatQty(row.balance)}</td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="7">Nenhuma movimentação encontrada para este produto${filterDate ? " nesta data" : ""}.</td>
    </tr>
  `;
}

function stockLedgerDocumentCell(row) {
  const documentLabel = escapeHtml(row.document || "-");
  if (row.canReverseStockTransfer && row.transferDocument) {
    return `
      <button class="ledger-doc-action" type="button"
        data-stock-ledger-transfer-reversal="${escapeAttr(row.transferDocument)}">
        ${documentLabel}
      </button>
    `;
  }
  if (row.canReverseStockEntry && row.sourceEntryId) {
    return `
      <button class="ledger-doc-action" type="button"
        data-stock-ledger-entry-reversal="${escapeAttr(row.sourceEntryId)}">
        ${documentLabel}
      </button>
    `;
  }
  if (!row.canReverseStockAllocation || !row.sourceEntryId || !row.allocationId) {
    return `<strong>${documentLabel}</strong>`;
  }
  return `
    <button class="ledger-doc-action" type="button"
      data-stock-ledger-reversal="${escapeAttr(row.sourceEntryId)}:${escapeAttr(row.allocationId)}">
      ${documentLabel}
    </button>
  `;
}

function closeStockLedgerActionMenu() {
  document.querySelector("#stock-ledger-action-menu")?.remove();
}

function showStockLedgerActionMenu(anchor, entryId, allocationId = "") {
  closeStockLedgerActionMenu();
  const menu = document.createElement("div");
  menu.id = "stock-ledger-action-menu";
  menu.className = "stock-ledger-action-menu";
  menu.innerHTML = `<button type="button">Estornar</button>`;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left + window.scrollX}px`;
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.querySelector("button").addEventListener("click", () => {
    closeStockLedgerActionMenu();
    if (allocationId) reverseStockEntryAllocation(entryId, allocationId);
    else reverseStockEntryToAvailable(entryId);
  });
}

function getStockEntryFilters() {
  const dateInput = qs("#stock-entry-date-filter");
  if (dateInput && !dateInput.value) dateInput.value = today;
  return {
    date: dateInput?.value || today,
    driver: normalizeSearch(qs("#stock-entry-driver-filter")?.value || ""),
    invoice: normalizeSearch(qs("#stock-entry-invoice-filter")?.value || ""),
    order: normalizeSearch(qs("#stock-entry-order-filter")?.value || ""),
    link: qs("#stock-entry-link-filter")?.value || "",
    general: normalizeSearch(qs("#stock-entry-general-filter")?.value || "")
  };
}

function stockEntryDestinationLabel(entry) {
  const allocations = entryAllocations(entry);
  if (allocations.length) {
    const labels = allocations.map((allocation) => {
      if (allocation.type === "stock") return `Estoque ${allocation.location}: ${formatQty(allocation.qty)}`;
      const order = state.orders.find((item) => item.id === allocation.orderId);
      return `${allocation.orderId || "Pedido"} ${order?.customer || ""}: ${formatQty(allocation.qty)}`.trim();
    });
    const remaining = entryRemainingQuantity(entry);
    if (remaining > 0.009) labels.push(`Saldo sem destino: ${formatQty(remaining)}`);
    return labels.join(" | ");
  }
  const linkedOrderId = entry.generatedOrderId || entry.linkedOrderId;
  if (linkedOrderId) return `Pedido ${linkedOrderId}`;
  if (stockLocations.includes(entry.location)) return `Estoque ${entry.location}`;
  return "Sem destino";
}

function stockEntryDestinationClass(entry) {
  if (entry.distributionStarted) return entryRemainingQuantity(entry) <= 0.009 ? "ok" : "danger";
  if (entry.generatedOrderId || entry.linkedOrderId) return "ok";
  if (stockLocations.includes(entry.location)) return "warn";
  return "danger";
}

function renderStockEntryDestination(entry) {
  const remaining = entryRemainingQuantity(entry);
  const complete = entry.distributionStarted && remaining <= 0.009;

  return `
    <div class="entry-destination">
      <span class="status ${stockEntryDestinationClass(entry)}">${stockEntryDestinationLabel(entry)}</span>
      ${complete ? "" : `
        <select class="table-select" data-stock-entry-destination="${entry.id}">
          <option value=""></option>
          ${stockLocations.map((location) => `<option value="${location}">${location}</option>`).join("")}
        </select>
      `}
    </div>
  `;
}

function stockEntryGroupKey(entry) {
  return [
    entry.date || "",
    entry.invoice || "",
    normalizeSearch(entry.supplier || ""),
    cleanOvNumber(entry.factoryOrder) || normalizeSearch(entry.factoryOrder || ""),
    normalizeSearch(cleanDriverName(entry.loadedBy || ""))
  ].join("|");
}

function groupStockEntries(entries) {
  const groups = [];
  const byKey = new Map();

  entries.forEach((entry) => {
    const key = stockEntryGroupKey(entry);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        main: entry,
        entries: [],
        totalQty: 0
      });
      groups.push(byKey.get(key));
    }
    const group = byKey.get(key);
    group.entries.push(entry);
    group.totalQty += Number(entry.quantity || 0);
  });

  return groups;
}

function uniqueCleanValues(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeSearch(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderStockEntryProducts(entries) {
  return `
    <div class="entry-products-list">
      ${entries.map((entry) => `
        <div>
          <strong>${entry.product}</strong>
          <span>${formatQty(entry.quantity)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderStockEntryGroupDestinations(entries) {
  return `
    <div class="entry-group-destinations">
      ${entries.map((entry) => `
        <div class="entry-group-destination-item">
          ${entries.length > 1 ? `<strong>${entry.product}</strong>` : ""}
          ${renderStockEntryDestination(entry)}
        </div>
      `).join("")}
    </div>
  `;
}

function renderStockUnitButtons(entry) {
  return stockLocations.map((location) => `
    <button class="print-btn" type="button" data-stock-entry-unit="${entry.id}:${location}">
      Enviar saldo para ${location}
    </button>
  `).join("");
}

function stockEntryReversibleStockAllocations(entry) {
  if (!isInvoiceStockEntry(entry)) return [];
  const allocations = entryAllocations(entry);
  const stockAllocations = allocations
    .filter((allocation) => allocation.type === "stock")
    .map((allocation) => ({
      id: allocation.id,
      direct: false,
      location: normalizeStockLocationOrBlank(allocation.location) || findStockLocationInText(allocation.destination),
      qty: Number(allocation.qty || 0)
    }))
    .filter((allocation) => allocation.location && allocation.qty > 0);

  if (stockAllocations.length) return stockAllocations;

  const directLocation = normalizeStockLocationOrBlank(entry.location)
    || findStockLocationInText(entry.destination)
    || findStockLocationInText(entry.destino)
    || findStockLocationInText(entry.unit)
    || findStockLocationInText(entry.stockLocation);
  const directQty = Number(entry.quantity || 0);
  const hasOrderAllocation = allocations.some((allocation) => allocation.type === "order");
  if (directLocation && directQty > 0 && !hasOrderAllocation) {
    return [{
      id: "",
      direct: true,
      location: directLocation,
      qty: directQty
    }];
  }
  return [];
}

function renderStockEntryGroupActions(entries) {
  const reversibleEntries = entries.filter((entry) => stockEntryReversibleStockAllocations(entry).length);
  const pending = entries.filter((entry) => {
    if (entryRemainingQuantity(entry) <= 0.009) return false;
    const isWarehouseOnly = !entryAllocations(entry).length && stockEntryReversibleStockAllocations(entry).some((allocation) => allocation.direct);
    return !isWarehouseOnly;
  });
  if (!pending.length) {
    return `
      <div class="entry-distribution-actions">
        <span class="status ok">Distribuição concluida</span>
        ${reversibleEntries.map((entry) => `
          <button class="danger-btn" type="button" data-reverse-stock-entry="${entry.id}">
            Estornar unidade
          </button>
        `).join("")}
      </div>
    `;
  }
  const groupIds = pending.map((entry) => entry.id).join(",");
  const showSingleOrderOption = pending.length > 1;

  return `
    <div class="entry-distribution-actions">
      ${showSingleOrderOption ? `
        <button class="stage-btn" type="button" data-direct-order-group="${escapeAttr(groupIds)}">
          Criar pedido unico
        </button>
        <span class="muted small">Ou distribua por produto abaixo</span>
      ` : ""}
      ${pending.map((entry) => `
        <div class="entry-action-line">
          ${entries.length > 1 ? `<strong>${entry.product}</strong>` : ""}
          <span class="tag">Saldo ${formatQty(entryRemainingQuantity(entry))}</span>
          <button class="stage-btn" type="button" data-direct-order-entry="${entry.id}">
            Criar pedido deste produto
          </button>
        </div>
      `).join("")}
    </div>
  `;
}

function entryAllocations(entry) {
  if (!Array.isArray(entry.allocations)) entry.allocations = [];
  return entry.allocations;
}

function entryAllocatedQuantity(entry) {
  return entryAllocations(entry).reduce((sum, allocation) => sum + Number(allocation.qty || 0), 0);
}

function entryRemainingQuantity(entry) {
  return Math.max(0, Number(entry.quantity || 0) - entryAllocatedQuantity(entry));
}

function invoiceLinkedOrderIds(entry) {
  const supplier = normalizeSearch(entry.supplier);
  const ids = state.stockEntries
    .filter((item) => item.invoice === entry.invoice && normalizeSearch(item.supplier) === supplier)
    .flatMap((item) => [
      ...entryAllocations(item)
        .filter((allocation) => allocation.type === "order")
        .map((allocation) => allocation.orderId),
      item.generatedOrderId,
      item.linkedOrderId
    ])
    .filter(Boolean);

  return Array.from(new Set(ids))
    .filter((orderId) => state.orders.some((order) => order.id === orderId));
}

function renderInvoiceDestinationsSummary() {
  const container = qs("#invoice-destinations-summary");
  if (!container) return;
  const entry = state.stockEntries.find((item) => item.id === linkedInvoiceEntryId);
  if (!entry) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  const supplier = normalizeSearch(entry.supplier);
  const invoiceEntries = state.stockEntries.filter((item) => item.invoice === entry.invoice
    && normalizeSearch(item.supplier) === supplier);
  const destinations = [];

  invoiceEntries.forEach((item) => {
    entryAllocations(item).forEach((allocation) => {
      if (allocation.type === "stock" && allocation.location) {
        destinations.push(`
          <span class="unit-destination-control">
            <strong>Estoque</strong>
            <select class="table-select" data-unit-destination-select="${item.id}:${allocation.id}">
              ${stockLocations.map((location) => `<option value="${location}" ${location === allocation.location ? "selected" : ""}>${location}</option>`).join("")}
            </select>
            <strong>${formatQty(allocation.qty)}</strong>
            <button class="print-btn" type="button" data-update-unit-destination="${item.id}:${allocation.id}">Alterar</button>
          </span>
        `);
      }
    });
    if (!item.distributionStarted && stockLocations.includes(item.location)) {
      destinations.push(`
        <span class="unit-destination-control">
          <strong>Estoque</strong>
          <select class="table-select" data-unit-destination-select="${item.id}:legacy">
            ${stockLocations.map((location) => `<option value="${location}" ${location === item.location ? "selected" : ""}>${location}</option>`).join("")}
          </select>
          <strong>${formatQty(item.quantity)}</strong>
          <button class="print-btn" type="button" data-update-unit-destination="${item.id}:legacy">Alterar</button>
        </span>
      `);
    }
  });

  container.hidden = !destinations.length;
  container.innerHTML = destinations.length
    ? `<div class="invoice-destination-list">${destinations.join("")}</div>`
    : "";
}

function updateInvoiceUnitDestination(entryId, allocationId, nextLocation) {
  const entry = state.stockEntries.find((item) => item.id === entryId);
  if (!entry || !stockLocations.includes(nextLocation)) return;

  const isLegacy = allocationId === "legacy";
  const allocation = isLegacy
    ? null
    : entryAllocations(entry).find((item) => item.id === allocationId && item.type === "stock");
  if (!isLegacy && !allocation) {
    showToast("Entrada da unidade nao encontrada.");
    return;
  }

  const oldLocation = isLegacy ? entry.location : allocation.location;
  const quantity = Number(isLegacy ? entry.quantity : allocation.qty) || 0;
  if (oldLocation === nextLocation) {
    showToast("A entrada ja esta nesta unidade.");
    return;
  }
  if (!assertStockDateUnlocked(entry.date, "alterar esta entrada de unidade")) {
    renderInvoiceDestinationsSummary();
    return;
  }

  const product = findStockProductForEntry(entry);
  if (!product) {
    showToast("Produto da nota nao encontrado no estoque.");
    return;
  }
  if (Number(product.locations?.[oldLocation] || 0) < quantity) {
    showToast(`Nao e possivel alterar: parte deste estoque de ${oldLocation} ja foi utilizada.`);
    renderInvoiceDestinationsSummary();
    return;
  }

  changeProductLocationQty(product, oldLocation, -quantity);
  changeProductLocationQty(product, nextLocation, quantity);
  if (isLegacy) entry.location = nextLocation;
  else allocation.location = nextLocation;
  saveState();
  renderAll();
  showToast(`Entrada transferida de ${oldLocation} para ${nextLocation}.`);
}

function openInvoiceOrders(entryId) {
  const entry = state.stockEntries.find((item) => item.id === entryId);
  if (!entry) return;
  const orderIds = invoiceLinkedOrderIds(entry);
  linkedInvoiceEntryId = entry.id;
  linkedInvoiceOrderIds = orderIds;
  qs("#orders-date-start-filter").value = "";
  qs("#orders-date-end-filter").value = "";
  qs("#orders-customer-filter").value = "";
  qs("#orders-finance-filter").value = "";
  qs('[data-view="pedidos"]').click();
  renderOrders();
  qs("#orders-table")?.closest(".panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(orderIds.length
    ? `${orderIds.length} pedido(s) e os destinos da NF ${entry.invoice}.`
    : `Destinos da NF ${entry.invoice}. Nenhum pedido vinculado.`);
}

function beginEntryDistribution(entry) {
  if (entry.distributionStarted) return;
  const oldLocation = stockLocations.includes(entry.location) ? entry.location : "";
  const product = findStockProductForEntry(entry);
  if (oldLocation && product) {
    changeProductLocationQty(product, oldLocation, -Number(entry.quantity || 0));
    state.movements.unshift({
      date: today,
      op: `Inicio da distribuição NF ${entry.invoice}`,
      product: entry.product,
      qty: -Number(entry.quantity || 0)
    });
  }
  entry.location = "";
  entry.distributionStarted = true;
}

function updateInvoiceDistributionStatus(entry) {
  const supplier = normalizeSearch(entry.supplier);
  const invoiceEntries = state.stockEntries.filter((item) => item.invoice === entry.invoice
    && normalizeSearch(item.supplier) === supplier);
  const complete = invoiceEntries.length > 0
    && invoiceEntries.every((item) => item.distributionStarted && entryRemainingQuantity(item) <= 0.009);
  const hasDestination = invoiceEntries.some((item) => {
    const allocations = entryAllocations(item);
    return allocations.some((allocation) => allocation.type === "order" || allocation.type === "stock")
      || Boolean(item.generatedOrderId || item.linkedOrderId)
      || (!item.distributionStarted && stockLocations.includes(normalizeStockLocationOrBlank(item.location)));
  });
  state.notes.forEach((note) => {
    if (note.number === entry.invoice && normalizeSearch(note.supplier) === supplier) {
      note.status = complete
        ? "Distribuição concluida"
        : hasDestination
          ? "Distribuição pendente"
          : "Importada";
      note.location = "";
    }
  });
}

function renderStockEntries() {
  const filters = getStockEntryFilters();
  const entries = state.stockEntries.filter(isInvoiceStockEntry).filter((entry) => {
    const driver = normalizeSearch(cleanDriverName(entry.loadedBy));
    const invoice = normalizeSearch(entry.invoice);
    const order = normalizeSearch([entry.factoryOrder, entry.ovNumber].filter(Boolean).join(" "));
    const general = normalizeSearch([
      entry.date,
      entry.product,
      entry.brand,
      entry.loadedBy,
      entry.invoice,
      entry.factoryOrder,
      entry.ovNumber,
      entry.location,
      stockEntryDestinationLabel(entry),
      entry.supplier
    ].join(" "));

    const dateMatches = !filters.date || entry.date === filters.date;
    const driverMatches = !filters.driver || driver.includes(filters.driver);
    const invoiceMatches = !filters.invoice || invoice.includes(filters.invoice);
    const orderMatches = !filters.order || order.includes(filters.order);
    const generalMatches = !filters.general || general.includes(filters.general);
    const allocations = entryAllocations(entry);
    const hasOrder = allocations.some((allocation) => allocation.type === "order")
      || Boolean(entry.generatedOrderId || entry.linkedOrderId);
    const hasLocation = allocations.some((allocation) => allocation.type === "stock")
      || (!entry.distributionStarted && stockLocations.includes(entry.location));
    const linkMatches = !filters.link
      || (filters.link === "no-order" && !hasOrder)
      || (filters.link === "no-location" && !hasLocation)
      || (filters.link === "pending" && !hasOrder && !hasLocation)
      || (filters.link === "stock" && !hasOrder && hasLocation)
      || (filters.link === "linked" && hasOrder);

    return dateMatches && driverMatches && invoiceMatches && orderMatches && generalMatches && linkMatches;
  });

  const groups = groupStockEntries(entries);
  qs("#stock-entries-count").textContent = `${groups.length} entradas`;
  qs("#stock-entries-table").innerHTML = groups.map((group) => {
    const entry = group.main;
    const brands = uniqueCleanValues(group.entries.map((item) => item.brand)).join(" / ") || "-";
    const drivers = uniqueCleanValues(group.entries.map((item) => cleanDriverName(item.loadedBy))).join(" / ") || "-";
    const suppliers = uniqueCleanValues(group.entries.map((item) => item.supplier)).join(" / ") || "-";
    return `
    <tr>
      <td>${entry.date.split("-").reverse().join("/")}</td>
      <td>
        <button class="invoice-link-btn" type="button" title="Ver pedidos desta nota" data-stock-entry-orders="${entry.id}">
          ${entry.invoice}
        </button>
      </td>
      <td>${cleanOvNumber(entry.factoryOrder) || entry.factoryOrder || "-"}</td>
      <td>${renderStockEntryGroupDestinations(group.entries)}</td>
      <td>${renderStockEntryProducts(group.entries)}</td>
      <td>${brands}</td>
      <td>${drivers}</td>
      <td class="right">${formatQty(group.totalQty)}</td>
      <td>${suppliers}</td>
      <td>${renderStockEntryGroupActions(group.entries)}</td>
    </tr>
  `;
  }).join("");
}
function customerMatchesSearch(customer, searchValue) {
  const search = normalizeSearch(searchValue);
  const searchDoc = cleanDocument(searchValue);
  if (!search && !searchDoc) return true;

  const searchable = normalizeSearch([
    customer.name,
    customer.fantasy,
    customer.address,
    customer.phone,
    formatDocument(customer.document),
    customer.document
  ].join(" "));

  const wordMatches = search.split(" ").filter(Boolean).every((word) => searchable.includes(word));
  return wordMatches || (searchDoc && customer.document.includes(searchDoc));
}

function customerSearchOptions(searchValue = "") {
  const options = [
    ...state.customers,
    ...Object.entries(receitaMock).map(([document, customer]) => ({ document, ...customer }))
  ];
  const unique = new Map(options.map((customer) => [customer.document, customer]));
  return Array.from(unique.values())
    .filter((customer) => customerMatchesSearch(customer, searchValue))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
}

function renderCustomerOptions(searchValue = "") {
  const results = qs("#customer-search-results");
  if (!results) return;
  const search = String(searchValue || "").trim();
  if (search.length < 2 && cleanDocument(search).length < 3) {
    results.hidden = true;
    results.innerHTML = "";
    return;
  }

  const customers = customerSearchOptions(search).slice(0, 8);
  results.hidden = false;
  results.innerHTML = customers.length ? customers.map((customer) => `
    <button class="customer-result-row" type="button" data-select-customer="${customer.document}">
      <strong>${customer.name || "Cliente sem nome"}</strong>
      <span>${formatDocument(customer.document)}${customer.phone ? ` a€¢ ${customer.phone}` : ""}</span>
      <small>${customer.address || "Endereco nao informado"}</small>
    </button>
  `).join("") : `
    <div class="customer-result-empty">Nenhum cliente encontrado. Digite o CNPJ completo e clique em Buscar.</div>
  `;
}

function renderCustomers() {
  const search = activeCustomerSearch || qs("#customers-search")?.value.trim() || "";
  const cityFilter = normalizeSearch(qs("#customers-city-filter")?.value || "");
  const sellerFilter = qs("#customers-seller-filter")?.value || "";
  const customers = state.customers.filter((customer) => {
    const city = normalizeSearch(customerCityText(customer));
    const seller = resolveCustomerSalesperson(customer);
    const cityMatches = !cityFilter || city.includes(cityFilter);
    const sellerMatches = !sellerFilter || seller === sellerFilter;
    return customerMatchesSearch(customer, search) && cityMatches && sellerMatches;
  });

  const hasFilter = Boolean(search || cityFilter || sellerFilter);
  const visibleCustomers = hasFilter ? customers : customers.slice(0, 120);
  qs("#customers-count").textContent = hasFilter ? `${customers.length} encontrados` : `${customers.length} clientes`;
  const status = qs("#customers-search-status");
  if (status) {
    status.textContent = hasFilter
      ? customers.length
        ? "Resultado dos filtros selecionados."
        : "Nenhum cliente encontrado para os filtros selecionados."
      : customers.length > visibleCustomers.length
        ? `Mostrando os primeiros ${visibleCustomers.length}. Use os filtros para localizar mais rapido.`
        : "Digite um cliente e clique em buscar.";
  }

  qs("#customers-table").innerHTML = visibleCustomers.length ? visibleCustomers.map((customer) => `
    <tr>
      <td><strong>${formatDocument(customer.document)}</strong></td>
      <td>${customer.name}</td>
      <td>${shortCityName(customerCityText(customer)) || "-"}</td>
      <td>${customerAddressWithoutCity(customer)}</td>
      <td>${resolveCustomerSalesperson(customer) || "-"}</td>
      <td class="right">
        <div class="order-actions">
          <button class="print-btn" type="button" data-edit-customer="${customer.document}">Editar</button>
          <button class="danger-btn" type="button" data-delete-customer="${customer.document}">Excluir</button>
        </div>
      </td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="6" class="empty-row">Nenhum cliente encontrado.</td>
    </tr>
  `;
}

function renderProducts() {
  qs("#products-count").textContent = `${state.stock.length} produtos`;
  qs("#products-table").innerHTML = state.stock.map((item) => `
    <tr>
      <td><strong>${item.product}</strong></td>
      <td>${item.factory}</td>
      <td>${item.batch}</td>
      <td class="right">${formatQty(item.qty)}</td>
      <td class="right">${formatQty(item.min)}</td>
      <td class="right">
        <button class="print-btn" type="button" data-edit-product="${item.id}">Editar</button>
        <button class="danger-btn" type="button" data-delete-product="${item.id}">Excluir</button>
      </td>
    </tr>
  `).join("");
}

function orderFinancialStatus(order) {
  const receivables = state.receivables.filter((item) => item.origin === order.id);
  if (!receivables.length) return order.status || "Aberto";
  if (receivables.every((item) => item.status === "Recebido" || receivableBalance(item) <= 0)) return "Recebido";
  if (receivables.some((item) => Number(item.paidValue || 0) > 0 || item.status === "Parcial")) return "Parcial";
  return "Aberto";
}

function renderOrders() {
  renderInvoiceDestinationsSummary();
  const filterStartDate = qs("#orders-date-start-filter")?.value || "";
  const filterEndDate = qs("#orders-date-end-filter")?.value || "";
  const filterCustomer = normalizeSearch(qs("#orders-customer-filter")?.value || "");
  const filterCustomerDoc = cleanDocument(qs("#orders-customer-filter")?.value || "");
  const filterFinance = qs("#orders-finance-filter")?.value || "";
  const orders = state.orders.filter((order) => {
    const dateMatches = (!filterStartDate || order.date >= filterStartDate) && (!filterEndDate || order.date <= filterEndDate);
    const customerText = normalizeSearch([order.customer, order.customerDoc, formatDocument(order.customerDoc)].join(" "));
    const customerMatches = !filterCustomer
      || customerText.includes(filterCustomer)
      || (filterCustomerDoc && cleanDocument(order.customerDoc).includes(filterCustomerDoc));
    const financeMatches = !filterFinance || orderFinancialStatus(order) === filterFinance;
    const invoiceMatches = !linkedInvoiceEntryId || linkedInvoiceOrderIds.includes(order.id);
    return dateMatches && customerMatches && financeMatches && invoiceMatches;
  });
  qs("#orders-count").textContent = `${orders.length} pedidos`;
  qs("#orders-value-total").textContent = money.format(orders.reduce((sum, order) => sum + Number(order.value || 0), 0));
  qs("#orders-table").innerHTML = orders.map((order) => `
    <tr>
      <td><strong>${order.id}</strong></td>
      <td>${order.date.split("-").reverse().join("/")}</td>
      <td>${order.customer}</td>
      <td>${orderItemsHtml(order)}</td>
      <td>${order.salesperson || "Nao informado"}</td>
      <td>${order.sellerName || "Nao informado"}</td>
      <td class="right">${money.format(order.value)}</td>
      <td><span class="status ${statusClass(orderFinancialStatus(order))}">${orderFinancialStatus(order)}</span></td>
      <td class="right">
        <div class="order-actions">
          <button class="print-btn" type="button" data-edit-order="${order.id}">Editar</button>
          <button class="print-btn" type="button" data-print-order="${order.id}">Imprimir</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderConfigOrders() {
  const dateInput = qs("#config-orders-date-filter");
  if (dateInput && !dateInput.value) dateInput.value = today;
  const dateFilter = dateInput?.value || today;
  const numberFilter = normalizeSearch(qs("#config-orders-number-filter")?.value || "");
  const orders = state.orders.filter((order) => {
    const dateMatches = !dateFilter || order.date === dateFilter;
    const numberMatches = !numberFilter || normalizeSearch(order.id).includes(numberFilter);
    return dateMatches && numberMatches;
  });
  const counter = qs("#config-orders-count");
  const table = qs("#config-orders-table");
  if (counter) counter.textContent = `${orders.length} pedidos`;
  if (table) {
    table.innerHTML = orders.length ? orders.map((order) => `
      <tr>
        <td><strong>${order.id}</strong></td>
        <td>${formatDateBR(order.date)}</td>
        <td>${order.customer || "-"}</td>
        <td class="right">${money.format(Number(order.value || 0))}</td>
        <td><input class="settings-input order-delete-reason" data-order-delete-reason="${order.id}" placeholder="Informe o motivo da exclusão" /></td>
        <td class="right"><button class="danger-btn" type="button" data-config-delete-order="${order.id}">Excluir</button></td>
      </tr>
    `).join("") : `
      <tr><td colspan="6" class="center muted">Nenhum pedido encontrado.</td></tr>
    `;
  }

  const history = qs("#deleted-orders-table");
  const historyCount = qs("#deleted-orders-count");
  if (historyCount) historyCount.textContent = `${state.deletedOrders.length} exclusoes`;
  if (history) {
    history.innerHTML = state.deletedOrders.length ? state.deletedOrders.map((record) => `
      <tr>
        <td><strong>${record.orderId || "-"}</strong></td>
        <td>${formatDateBR(record.orderDate)}</td>
        <td>${record.deletedAt ? new Date(record.deletedAt).toLocaleString("pt-BR") : "-"}</td>
        <td>${escapeAttr(record.deletedBy || "-")}</td>
        <td>${escapeAttr(record.reason || "-")}</td>
      </tr>
    `).join("") : `
      <tr><td colspan="5" class="center muted">Nenhum pedido excluído.</td></tr>
    `;
  }
}

function renderLogistics() {
  const dateInput = qs("#logistics-date-filter");
  if (dateInput && !dateInput.value) dateInput.value = today;
  const filterDate = dateInput?.value || today;
  const filterStage = qs("#logistics-stage-filter")?.value || "";

  const orders = state.orders.filter((order) => {
    const dateMatches = order.date === filterDate;
    const stageMatches = !filterStage || order.deliveryStatus === filterStage;
    return dateMatches && stageMatches;
  });

  qs("#logistics-count").textContent = `${orders.length} pedidos`;
  qs("#logistics-table").innerHTML = orders.length ? orders.map((order) => `
    <tr>
      <td><strong>${order.id}</strong><br><small>${order.date.split("-").reverse().join("/")}</small></td>
      <td>${order.customer}<br><small>${order.address || "-"}</small></td>
      <td>${orderItemsHtml(order)}</td>
      <td class="right">${formatQty(order.qty)}</td>
      <td><span class="logistics-readonly">${escapeHtml(order.driver || "Nao informado")}</span></td>
      <td><input type="date" value="${escapeAttr(order.deliveryForecast)}" data-logistics-field="${order.id}" data-field="deliveryForecast" /></td>
      <td><span class="logistics-readonly">${escapeHtml(order.observation || "-")}</span></td>
      <td>
        <div class="order-actions">
          ${order.directLoad
            ? `<span class="stage-btn logistics-static-action">Entregue</span>`
            : order.deliveryStatus === "Entregue"
              ? `<button class="stage-btn" type="button" title="Clique para estornar a baixa" data-logistics-action="${order.id}" data-stage="Pedido">Entregue</button>`
              : `<button class="danger-btn" type="button" data-logistics-action="${order.id}" data-stage="Entregue">Baixar</button>`}
        </div>
      </td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="8" class="empty-row">Nenhum pedido encontrado na logistica.</td>
    </tr>
  `;
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function paymentDueDays(paymentName) {
  const numbers = String(paymentName || "").match(/\d+/g)?.map(Number).filter((day) => day >= 0) || [];
  if (numbers.length) return numbers;
  return [0];
}

function receivableBalance(receivable) {
  return Math.max(0, Number(receivable.value || 0) - Number(receivable.paidValue || 0));
}

function formatDateBR(dateValue) {
  return dateValue ? String(dateValue).split("-").reverse().join("/") : "";
}

function formatTimeBR(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatOrderPrintDateTime(order) {
  const date = formatDateBR(order?.date || today);
  const time = formatTimeBR(order?.issuedAt || order?.createdAt || order?.updatedAt || "");
  return time ? `${date} ${time}` : date;
}

function orderStockDate(order) {
  return order?.deliveryForecast || order?.date || today;
}

function parseMoneyInput(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const cleanText = text.replace(/[^\d.,-]/g, "");
  const normalized = cleanText.includes(",")
    ? cleanText.replace(/\./g, "").replace(",", ".")
    : cleanText;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function buildReceivablesForOrder(order) {
  const dueDays = paymentDueDays(order.paymentTerm || order.payment);
  const installments = dueDays.length;
  const cents = Math.round(Number(order.value || 0) * 100);
  const baseCents = Math.floor(cents / installments);
  const isAutomaticBoletoReceipt = normalizeSearch(order.payment).includes("boleto");
  let usedCents = 0;

  return dueDays.map((days, index) => {
    const installmentCents = index === installments - 1 ? cents - usedCents : baseCents;
    usedCents += installmentCents;
    return {
      id: `${order.id}-P${index + 1}`,
      due: addDays(order.date || today, days),
      customer: order.customer,
      origin: order.id,
      installment: `${index + 1}/${installments}`,
      value: installmentCents / 100,
      paidValue: isAutomaticBoletoReceipt ? installmentCents / 100 : 0,
      status: isAutomaticBoletoReceipt ? "Recebido" : "Aberto",
      payment: order.payment,
      salesperson: order.salesperson || "Nao informado",
      billingStatus: "Nao faturado",
      accountId: "",
      paymentDate: isAutomaticBoletoReceipt ? (order.date || today) : ""
    };
  });
}

function migrateExistingBoletoReceipts() {
  if (state.autoBoletoReceiptsMigrated) return;
  state.receivables.forEach((receivable) => {
    const order = state.orders.find((item) => item.id === receivable.origin);
    const paymentMethod = order?.payment || receivable.payment || "";
    if (!normalizeSearch(paymentMethod).includes("boleto")) return;
    receivable.payment = paymentMethod;
    receivable.paidValue = Number(receivable.value || 0);
    receivable.status = "Recebido";
    receivable.paymentDate = order?.date || receivable.paymentDate || today;
  });
  state.orders.forEach((order) => {
    if (normalizeSearch(order.payment).includes("boleto")) order.status = "Recebido";
  });
  state.autoBoletoReceiptsMigrated = true;
  saveState();
}

function replaceOpenReceivablesForOrder(order) {
  const existing = state.receivables.filter((item) => item.origin === order.id);
  const hasReceived = existing.some((item) => item.status === "Recebido");
  const isBoletoNow = normalizeSearch(order.payment).includes("boleto");
  const looksLikeAutomaticBoletoReceipt = existing.length && existing.every((item) => {
    const paidValue = Number(item.paidValue || 0);
    const value = Number(item.value || 0);
    return item.status === "Recebido"
      && Math.abs(paidValue - value) < 0.01
      && (item.paymentDate || "") === (order.date || today);
  });
  if (hasReceived && !(looksLikeAutomaticBoletoReceipt && !isBoletoNow)) {
    existing.forEach((item) => {
      if (item.status !== "Recebido") {
        item.customer = order.customer;
        item.payment = order.payment;
        item.billingStatus = item.billingStatus || "Nao faturado";
        item.salesperson = order.salesperson || "Nao informado";
      }
    });
    return;
  }
  state.receivables = state.receivables.filter((item) => item.origin !== order.id);
  state.receivables.unshift(...buildReceivablesForOrder(order));
}

function boletoExportReceivables() {
  const start = qs("#omie-export-start")?.value || "";
  const end = qs("#omie-export-end")?.value || "";
  const status = qs("#omie-export-status")?.value || "";
  const billing = qs("#omie-export-billing")?.value || "";
  return state.receivables.filter((item) => {
    const order = state.orders.find((orderItem) => orderItem.id === item.origin);
    const issueDate = order?.date || "";
    const isBoleto = normalizeSearch(item.payment).includes("boleto");
    const startMatches = !start || issueDate >= start;
    const endMatches = !end || issueDate <= end;
    const statusMatches = !status || item.status === status;
    const billingMatches = !billing || (item.billingStatus || "Nao faturado") === billing;
    return isBoleto && startMatches && endMatches && statusMatches && billingMatches;
  });
}

function boletoExportOrders() {
  const orderIds = new Set(boletoExportReceivables().map((item) => item.origin));
  return state.orders
    .filter((order) => orderIds.has(order.id))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
}

function renderBoletoExportSummary() {
  const receivables = boletoExportReceivables();
  const orders = new Set(receivables.map((item) => item.origin));
  const total = receivables.reduce((sum, item) => sum + receivableBalance(item), 0);
  const label = `${orders.size} pedidos / ${receivables.length} boletos / ${money.format(total)}`;
  const counter = qs("#omie-export-count");
  if (counter) counter.textContent = label;
  renderOmieBoletosTable(receivables);
}

function renderOmieBoletosTable(receivables = boletoExportReceivables()) {
  const table = qs("#omie-boletos-table");
  if (!table) return;
  const rows = [...receivables].sort((a, b) => {
    const orderA = state.orders.find((order) => order.id === a.origin);
    const orderB = state.orders.find((order) => order.id === b.origin);
    return String(orderA?.date || "").localeCompare(String(orderB?.date || "")) || String(a.due || "").localeCompare(String(b.due || ""));
  });
  table.innerHTML = rows.length ? rows.map((item) => {
    const order = state.orders.find((orderItem) => orderItem.id === item.origin);
    return `
      <tr>
        <td>${formatDateBR(order?.date || "")}</td>
        <td>${formatDateBR(item.due)}</td>
        <td><strong>${item.origin}</strong> <span class="muted">${item.installment || ""}</span></td>
        <td>${item.customer}</td>
        <td>${item.salesperson || "Nao informado"}</td>
        <td class="right">${money.format(item.value)}</td>
        <td><span class="status ${statusClass(item.status)}">${item.status}</span></td>
        <td>
          <select class="table-select" data-omie-billing="${item.id}">
            <option value="Nao faturado" ${(item.billingStatus || "Nao faturado") === "Nao faturado" ? "selected" : ""}>Nao faturado</option>
            <option value="Faturado" ${item.billingStatus === "Faturado" ? "selected" : ""}>Faturado</option>
          </select>
        </td>
      </tr>
    `;
  }).join("") : `
    <tr>
      <td colspan="8" class="center muted">Nenhum boleto encontrado para os filtros selecionados.</td>
    </tr>
  `;
}

function renderReceivables() {
  const clientFilter = normalizeSearch(qs("#finance-filter-client")?.value || "");
  const orderFilter = normalizeSearch(qs("#finance-filter-order")?.value || "");
  const dueDate = qs("#finance-filter-due")?.value || "";
  const valueFilter = parseMoneyInput(qs("#finance-filter-value")?.value || "");
  const sellerFilter = normalizeSearch(qs("#finance-filter-seller")?.value || "");
  const paymentFilter = normalizeSearch(qs("#finance-filter-payment")?.value || "");
  const statusFilter = qs("#finance-filter-status")?.value || "";
  const receivables = state.receivables.filter((item) => {
    const value = Number(item.value || 0);
    const clientMatches = !clientFilter || normalizeSearch(item.customer).includes(clientFilter);
    const orderMatches = !orderFilter || normalizeSearch(item.origin).includes(orderFilter);
    const dueMatches = !dueDate || item.due === dueDate;
    const valueMatches = !valueFilter || Math.abs(value - valueFilter) <= 0.009;
    const sellerMatches = !sellerFilter || normalizeSearch(item.salesperson).includes(sellerFilter);
    const paymentMatches = !paymentFilter || normalizeSearch(item.payment).includes(paymentFilter);
    const statusMatches = !statusFilter || item.status === statusFilter;
    return clientMatches && orderMatches && dueMatches && valueMatches && sellerMatches && paymentMatches && statusMatches;
  }).sort((a, b) => String(a.due || "").localeCompare(String(b.due || "")));
  const receivablesCount = qs("#receivables-count");
  if (receivablesCount) receivablesCount.textContent = `${receivables.length} recebimentos`;
  const valueTotal = receivables.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const paidTotal = receivables.reduce((sum, item) => sum + Number(item.paidValue || 0), 0);
  const balanceTotal = receivables.reduce((sum, item) => sum + receivableBalance(item), 0);
  const totalPages = Math.max(1, Math.ceil(receivables.length / financePageSize));
  financeCurrentPage = Math.min(Math.max(1, financeCurrentPage), totalPages);
  const pageStart = (financeCurrentPage - 1) * financePageSize;
  const pageRows = receivables.slice(pageStart, pageStart + financePageSize);
  const pageEnd = receivables.length ? pageStart + pageRows.length : 0;
  qs("#finance-value-total").textContent = money.format(valueTotal);
  qs("#finance-paid-total").textContent = money.format(paidTotal);
  qs("#finance-balance-total").textContent = money.format(balanceTotal);
  const pageInfo = qs("#finance-page-info");
  if (pageInfo) pageInfo.textContent = receivables.length
    ? `${pageStart + 1} - ${pageEnd} de ${receivables.length} recebimentos`
    : "0 recebimentos";
  const pageLabel = qs("#finance-page-label");
  if (pageLabel) pageLabel.textContent = `Pagina ${financeCurrentPage} de ${totalPages}`;
  const prevButton = qs("#finance-prev-page");
  if (prevButton) prevButton.disabled = financeCurrentPage <= 1;
  const nextButton = qs("#finance-next-page");
  if (nextButton) nextButton.disabled = financeCurrentPage >= totalPages;
  qs("#receivables-table").innerHTML = pageRows.map((item) => {
    const paidValue = Number(item.paidValue || 0);
    const balance = receivableBalance(item);
    const isSettled = item.status === "Recebido";
    const isBoletoPayment = normalizeSearch(item.payment).includes("boleto");
    return `
    <tr>
      <td>${item.due.split("-").reverse().join("/")}</td>
      <td>
        <div class="finance-order-control">
          <strong>${item.origin}</strong>
          <span class="muted">${item.installment || ""}</span>
          <button class="print-btn" type="button" data-finance-order="${item.origin}">Abrir</button>
        </div>
      </td>
      <td title="${escapeAttr(item.customer)}">${item.customer}</td>
      <td>
        <select class="table-select" data-receivable-payment="${item.id}" data-current="${escapeAttr(item.payment || "")}" ${isSettled ? "disabled" : ""}></select>
      </td>
      <td class="right">${money.format(item.value)}</td>
      <td class="right">${money.format(paidValue)}</td>
      <td>${item.paymentDate ? item.paymentDate.split("-").reverse().join("/") : "-"}</td>
      <td class="right"><strong>${money.format(balance)}</strong></td>
      <td><span class="status ${statusClass(item.status)}">${item.status}</span></td>
      <td class="right">
        <div class="finance-pay-control">
          ${!isSettled
            ? `
              <input type="text" inputmode="decimal" placeholder="${balance.toFixed(2)}" data-partial-pay="${item.id}" />
              <input type="date" value="${item.paymentDate || today}" data-payment-date="${item.id}" />
              <button class="stage-btn" type="button" data-receivable-pay="${item.id}">Baixar</button>
            `
            : ""}
          ${paidValue > 0 ? `<button class="danger-btn" type="button" data-receivable-cancel="${item.id}">Cancelar</button>` : ""}
        </div>
      </td>
    </tr>
  `;
  }).join("") || `
    <tr>
      <td colspan="10" class="center muted">Nenhum recebimento encontrado para os filtros selecionados.</td>
    </tr>
  `;
  renderPaymentMethods();
  renderBoletoExportSummary();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function installmentCountForOrder(orderId) {
  return state.receivables.filter((item) => item.origin === orderId).length || 1;
}

function firstDueForOrder(orderId) {
  return state.receivables
    .filter((item) => item.origin === orderId)
    .map((item) => item.due)
    .filter(Boolean)
    .sort()[0] || today;
}

function downloadFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportBoletoOmieSpreadsheetLayout() {
  const orders = boletoExportOrders();
  if (!orders.length) {
    showToast("Nenhum pedido com boleto encontrado para exportar.");
    return;
  }
  const category = qs("#omie-export-category").value.trim() || "VENDA DE MERCADORIAS";
  const account = qs("#omie-export-account").value.trim() || "BANCO";
  const stockLocation = qs("#omie-export-stock-location").value.trim() || "DIVINA“POLIS";
  const headers = [
    "Código de Integração",
    "Cliente * (Razao Social, Nome Fantasia, CNPJ ou CPF)",
    "Previsao de Faturamento *",
    "Categoria *",
    "Numero de Parcelas *",
    "Vendedor",
    "Conta Corrente *",
    "No do Pedido do Cliente",
    "# Item",
    "Produto * (Código ou Descrição)",
    "Local de Estoque * (Código ou Descrição)",
    "Quantidade *",
    "Preco Unitario de Venda *",
    "Valor do Desconto",
    "Observações do Pedido"
  ];
  const rows = orders.map((order) => {
    const customerKey = order.customerDoc ? formatDocument(order.customerDoc) : order.customer;
    return [
      order.id,
      customerKey,
      formatDateBR(firstDueForOrder(order.id)),
      category,
      installmentCountForOrder(order.id),
      order.salesperson || "",
      account,
      order.id,
      1,
      order.product || "",
      stockLocation,
      Number(order.qty || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 }),
      Number(order.price || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
      "0",
      `Pedido ${order.id} - ${order.payment || "Boleto"}`
    ];
  });
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; }
          th, td { border: 1px solid #999; padding: 6px; mso-number-format:"\\@"; }
          th { background: #d9ead3; font-weight: bold; }
          .title { background: #1f6f45; color: #fff; font-size: 16px; }
        </style>
      </head>
      <body>
        <table>
          <tr><th class="title" colspan="${headers.length}">OMIE - PEDIDO DE VENDA - BOLETOS</th></tr>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
        </table>
      </body>
    </html>`;
  downloadFile(`omie_boletos_${today}.xls`, html, "application/vnd.ms-excel;charset=utf-8");
  showToast(`${orders.length} pedidos de boleto exportados.`);
}

function exportBoletoOmieSpreadsheet() {
  const orders = boletoExportOrders();
  if (!orders.length) {
    showToast("Nenhum pedido com boleto encontrado para exportar.");
    return;
  }
  const category = qs("#omie-export-category").value.trim() || "VENDA DE MERCADORIAS";
  const account = qs("#omie-export-account").value.trim() || "BANCO";
  const stockLocation = qs("#omie-export-stock-location").value.trim() || "DIVINA“POLIS";
  const td = (value = "", className = "") => `<td class="${className}">${escapeHtml(value)}</td>`;
  const blanks = (count) => Array.from({ length: count }, () => td()).join("");
  const orderBillingStatus = (orderId) => {
    const items = state.receivables.filter((item) => item.origin === orderId);
    return items.some((item) => item.billingStatus === "Faturado") ? "Faturado" : "Nao faturado";
  };
  const blocks = orders.map((order) => {
    const customerKey = order.customerDoc ? formatDocument(order.customerDoc) : order.customer;
    const qty = Number(order.qty || 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
    const price = Number(order.price || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    const notes = `Pedido ${order.id} - Boleto - ${orderBillingStatus(order.id)}`;
    return `
      <tr>${td("1. Dados da Venda", "section")}${blanks(30)}</tr>
      <tr>
        ${td("Código de Integração", "header")}${blanks(2)}
        ${td("Cliente * (Razao Social, Nome Fantasia, CNPJ ou CPF)", "header")}
        ${td("Previsao de Faturamento *", "header")}
        ${td("Categoria *", "header")}
        ${td("Numero de Parcelas *", "header")}
        ${td("Vendedor", "header")}
        ${td("Projeto", "header")}
        ${td("Conta Corrente *", "header")}
        ${td("No do Pedido do Cliente", "header")}
        ${td("No do Contrato de Venda", "header")}
        ${td("Contato", "header")}
        ${td("Observações do Pedido", "header")}${blanks(17)}
      </tr>
      <tr>
        ${td(order.id)}${blanks(2)}
        ${td(customerKey)}
        ${td(formatDateBR(firstDueForOrder(order.id)))}
        ${td(category)}
        ${td(installmentCountForOrder(order.id))}
        ${td(order.salesperson || "")}
        ${td("")}
        ${td(account)}
        ${td(order.id)}
        ${td("")}
        ${td("")}
        ${td(notes)}${blanks(17)}
      </tr>
      <tr>${td("2. Cenário Fiscal", "section")}${blanks(1)}${td("3. E-mail para o Cliente", "section")}${blanks(28)}</tr>
      <tr>${td("Consumo Final?", "header")}${blanks(2)}${td("Cenário Fiscal", "header")}${td("Dados Adicionais para a Nota Fiscal", "header")}${td("Enviar tambem o Boleto de Cobranca?", "header")}${blanks(1)}${td("Enviar tambem o Link de Cobranca?", "header")}${td("Enviar tambem o Pix de Cobranca?", "header")}${td("Utilizar os seguintes enderecos de E-mail", "header")}${blanks(21)}</tr>
      <tr>${td("Sim")}${blanks(2)}${td("Padrao")}${td("")}${td("Nao")}${blanks(1)}${td("Nao")}${td("Nao")}${td("")}${blanks(21)}</tr>
      <tr>${td("4. Frete e Outras Despesas", "section")}${blanks(30)}</tr>
      <tr>${td("Tipo do Frete", "header")}${blanks(2)}${td("Transportadora (Razao Social, Nome Fantasia, CNPJ ou CPF)", "header")}${td("Placa do Veiculo", "header")}${td("UF da Placa", "header")}${td("RNTRC (ANTT)", "header")}${td("Quantidade de Volumes", "header")}${td("Especie dos Volumes", "header")}${td("Marca dos Volumes", "header")}${td("Numeracao dos Volumes", "header")}${td("Numero do Lacre", "header")}${td("Peso Liquido (Kg)", "header")}${td("Peso Bruto (Kg)", "header")}${td("Valor do Frete", "header")}${td("Valor do Seguro", "header")}${td("Outras Despesas Acessorias", "header")}${td("Previsão de Entrega", "header")}${td("Codigo de Rastreio", "header")}${blanks(12)}</tr>
      <tr>${td("9 - Sem Frete")}${blanks(30)}</tr>
      <tr>${td("5. Itens do Pedido de Venda", "section")}${blanks(30)}</tr>
      <tr>${td("# Item", "header")}${blanks(1)}${td("Código de Integração", "header")}${td("Produto * (Código ou Descrição)", "header")}${td("Local de Estoque * (Código ou Descrição)", "header")}${td("Quantidade *", "header")}${td("Preco Unitario de Venda *", "header")}${td("Valor do Desconto", "header")}${td("Categoria do Item", "header")}${td("Numero do Pedido de Compra", "header")}${td("Item do Pedido de Compra", "header")}${td("Código do Benefício Fiscal", "header")}${td("Numero da FCI", "header")}${td("Informações para a Nota Fiscal", "header")}${td("Peso Liquido (Kg)", "header")}${td("Peso Bruto (Kg)", "header")}${td("Observações do Item", "header")}${td("Nao gerar a saida de estoque ao emitir a NF-e", "header")}${td("Nao somar este item no total da NF-e", "header")}${td("Nao Gerar Conta a Receber", "header")}${td("Cenário Fiscal", "header")}${td("Numero Lote", "header")}${td("Quantidade", "header")}${td("Data de Fabricação/Produção", "header")}${td("Data de Validade", "header")}${td("Código de Agregação", "header")}${td("Reservar Estoque", "header")}${td("CFOP", "header")}${td("Unidade Tributavel", "header")}${td("Quantidade Tributavel", "header")}${td("Codigo EAN (GTIN) Tributavel", "header")}</tr>
      <tr>${td("1")}${blanks(1)}${td(`${order.id}-1`)}${td(order.product || "")}${td(stockLocation)}${td(qty)}${td(price)}${td("0")}${td(category)}${td(order.id)}${td("1")}${td("")}${td("")}${td(notes)}${td("")}${td("")}${td(notes)}${td("Nao")}${td("Nao")}${td("Nao")}${td("Padrao")}${td("")}${td("")}${td("")}${td("")}${td("")}${td("Nao")}${td("")}${td("")}${td("")}${td("")}</tr>
      <tr>${blanks(31)}</tr>
    `;
  }).join("");
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px; }
          td { border: 1px solid #999; padding: 5px; white-space: pre-wrap; mso-number-format:"\\@"; }
          .title { background: #1f6f45; color: #fff; font-size: 16px; font-weight: bold; }
          .section { background: #d9ead3; font-weight: bold; }
          .header { background: #edf4ea; font-weight: bold; }
        </style>
      </head>
      <body>
        <table>
          <tr><td class="title" colspan="31">Omie_Pedido_Venda</td></tr>
          ${blocks}
        </table>
      </body>
    </html>`;
  downloadFile(`Omie_Pedido_Venda_boletos_${today}.xls`, html, "application/vnd.ms-excel;charset=utf-8");
  showToast(`${orders.length} pedidos de boleto exportados no layout Omie.`);
}

function reportMonths() {
  const base = new Date(`${today.slice(0, 7)}-01T00:00:00`);
  return [2, 1, 0].map((offset) => {
    const date = new Date(base);
    date.setMonth(base.getMonth() - offset);
    const key = date.toISOString().slice(0, 7);
    const label = date.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
    return { key, label };
  });
}

function excelCell(value, className = "") {
  let displayValue = value ?? "";
  let finalClassName = className;
  if (className === "money") {
    displayValue = money.format(Number(value || 0));
    finalClassName = "text-right";
  } else if (className === "number") {
    displayValue = Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    finalClassName = "text-right";
  } else if (className === "integer") {
    displayValue = Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    finalClassName = "text-right";
  }
  return `<td class="${finalClassName}">${escapeHtml(displayValue)}</td>`;
}

function downloadExcelWorkbook(filename, sheets) {
  const safeSheets = sheets.filter((sheet) => sheet.rows?.length);
  if (!safeSheets.length) {
    showToast("Nenhum dado encontrado para exportar.");
    return;
  }
  const content = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
          th, td { border: 1px solid #9aa89f; padding: 6px; mso-number-format:"\\@"; }
          th { background: #e8efe9; font-weight: 700; }
          .text-right { text-align: right; }
          .number { text-align: right; }
          .integer { text-align: right; }
          .money { text-align: right; }
          .date { mso-number-format:"dd/mm/yyyy"; }
          h2 { font-family: Arial, sans-serif; }
        </style>
      </head>
      <body>
        ${safeSheets.map((sheet) => `
          <h2>${escapeHtml(sheet.name)}</h2>
          <table>
            <thead>
              <tr>${sheet.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${sheet.rows.map((row) => `<tr>${row.map((cell) => excelCell(cell.value, cell.className || "")).join("")}</tr>`).join("")}
            </tbody>
          </table>
          <br>
        `).join("")}
      </body>
    </html>`;
  const blob = new Blob([content], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function salesReportData() {
  const sellerFilter = qs("#sales-report-seller-filter")?.value || "";
  const months = reportMonths();
  const monthTotals = months.map((month) => {
    const orders = state.orders.filter((order) => {
      const sameMonth = String(order.date || "").slice(0, 7) === month.key;
      const sameSeller = !sellerFilter || (order.salesperson || "NAO INFORMADO") === sellerFilter;
      return sameMonth && sameSeller;
    });
    const value = orders.reduce((sum, order) => sum + Number(order.value || 0), 0);
    const bags = orders.reduce((sum, order) => sum + Number(order.qty || 0), 0);
    return { month, orders: orders.length, value, bags, average: bags ? value / bags : 0 };
  });
  return { sellerFilter, months, monthTotals };
}

function sellerReportData() {
  const sellerFilter = qs("#sales-report-seller-filter")?.value || "";
  const months = reportMonths();
  const sellers = Array.from(new Set(state.orders.map((order) => order.salesperson || "NAO INFORMADO")))
    .filter((seller) => !sellerFilter || seller === sellerFilter)
    .sort();
  return sellers.map((seller) => {
    const orders = state.orders.filter((order) => (order.salesperson || "NAO INFORMADO") === seller);
    const monthValues = months.map((month) => orders
      .filter((order) => String(order.date || "").slice(0, 7) === month.key)
      .reduce((sum, order) => sum + Number(order.value || 0), 0));
    return {
      seller,
      monthValues,
      bags: orders.reduce((sum, order) => sum + Number(order.qty || 0), 0),
      orders: orders.length,
      total: orders.reduce((sum, order) => sum + Number(order.value || 0), 0)
    };
  }).sort((a, b) => b.total - a.total);
}

function freightValueForWeightedRow(row) {
  const rate = freightRateFor(row.freightType || "entrega", row.city);
  return rate ? Number(rate.value || 0) : 0;
}

function weightedAverageSummaryRows(rows = weightedAverageOrders()) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = `${normalizeSearch(row.city)}|${normalizeSearch(row.product)}`;
    const item = grouped.get(key) || { city: row.city, product: row.product, qty: 0, total: 0, freight: 0 };
    item.qty += row.qty;
    item.total += row.total;
    item.freight = item.freight || row.freight || 0;
    grouped.set(key, item);
  });
  return Array.from(grouped.values())
    .map((row) => ({ ...row, average: row.qty ? row.total / row.qty : 0 }))
    .sort((a, b) => a.city.localeCompare(b.city, "pt-BR") || a.product.localeCompare(b.product, "pt-BR"));
}

function exportSalesReportExcel() {
  const { sellerFilter, months, monthTotals } = salesReportData();
  const totalValue = monthTotals.reduce((sum, item) => sum + item.value, 0);
  const totalBags = monthTotals.reduce((sum, item) => sum + item.bags, 0);
  const totalOrders = monthTotals.reduce((sum, item) => sum + item.orders, 0);
  downloadExcelWorkbook(`relatorio-vendas-${today}.xls`, [{
    name: sellerFilter ? `Relatorio de vendas - ${sellerFilter}` : "Relatorio de vendas",
    headers: ["Indicador", ...months.map((month) => month.label), "Total"],
    rows: [
      [{ value: "Saldo de vendas" }, ...monthTotals.map((item) => ({ value: item.value, className: "money" })), { value: totalValue, className: "money" }],
      [{ value: "Sacos de cimento vendidos" }, ...monthTotals.map((item) => ({ value: item.bags, className: "integer" })), { value: totalBags, className: "integer" }],
      [{ value: "Preco medio por saco" }, ...monthTotals.map((item) => ({ value: item.average, className: "money" })), { value: totalBags ? totalValue / totalBags : 0, className: "money" }],
      [{ value: "Quantidade de pedidos" }, ...monthTotals.map((item) => ({ value: item.orders, className: "integer" })), { value: totalOrders, className: "integer" }]
    ]
  }]);
}

function exportSellerReportExcel() {
  const months = reportMonths();
  const rows = sellerReportData();
  downloadExcelWorkbook(`vendas-por-vendedor-${today}.xls`, [{
    name: "Vendas por vendedor",
    headers: ["Vendedor", ...months.map((month) => month.label), "Sacos", "Pedidos", "Total"],
    rows: rows.map((row) => [
      { value: row.seller },
      ...row.monthValues.map((value) => ({ value, className: "money" })),
      { value: row.bags, className: "integer" },
      { value: row.orders, className: "integer" },
      { value: row.total, className: "money" }
    ])
  }]);
}

function exportWeightedReportExcel() {
  const detailRows = weightedAverageOrders()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.city.localeCompare(b.city, "pt-BR"));
  const summaryRows = weightedAverageSummaryRows(detailRows);
  downloadExcelWorkbook(`media-ponderada-${today}.xls`, [
    {
      name: "Media ponderada",
      headers: ["Cidade", "Produto", "Quantidade", "Valor total", "Frete unitario", "Preco medio"],
      rows: summaryRows.map((row) => [
        { value: row.city },
        { value: row.product },
        { value: row.qty, className: "integer" },
        { value: row.total, className: "money" },
        { value: row.freight, className: "money" },
        { value: row.average, className: "money" }
      ])
    },
    {
      name: "Conferencia das vendas",
      headers: ["Data", "Cidade", "Produto", "Quantidade", "Preco unitario", "Valor total", "Frete unitario"],
      rows: detailRows.map((row) => [
        { value: formatDateBR(row.date), className: "date" },
        { value: row.city },
        { value: row.product },
        { value: row.qty, className: "integer" },
        { value: row.unitPrice, className: "money" },
        { value: row.total, className: "money" },
        { value: row.freight, className: "money" }
      ])
    }
  ]);
}

function renderSalesReport() {
  const sellerFilter = qs("#sales-report-seller-filter")?.value || "";
  const sellers = Array.from(new Set(state.orders.map((order) => order.salesperson || "NAO INFORMADO"))).sort();
  qs("#sales-report-seller-filter").innerHTML = [
    `<option value="">Todos</option>`,
    ...sellers.map((seller) => `<option value="${escapeAttr(seller)}" ${seller === sellerFilter ? "selected" : ""}>${seller}</option>`)
  ].join("");

  const months = reportMonths();
  months.forEach((month, index) => {
    qs(`#report-month-${index + 1}`).textContent = month.label;
    qs(`#seller-report-month-${index + 1}`).textContent = month.label;
  });

  const monthTotals = months.map((month) => {
    const orders = state.orders.filter((order) => {
      const sameMonth = String(order.date || "").slice(0, 7) === month.key;
      const sameSeller = !sellerFilter || (order.salesperson || "NAO INFORMADO") === sellerFilter;
      return sameMonth && sameSeller;
    });
    return {
      orders: orders.length,
      value: orders.reduce((sum, order) => sum + Number(order.value || 0), 0),
      cementBags: orders.reduce((sum, order) => sum + Number(order.qty || 0), 0)
    };
  });
  const totalSales = monthTotals.reduce((sum, item) => sum + item.value, 0);
  const totalCementBags = monthTotals.reduce((sum, item) => sum + item.cementBags, 0);
  const totalOrders = monthTotals.reduce((sum, item) => sum + item.orders, 0);

  qs("#sales-report-table").innerHTML = `
    <tr>
      <td><strong>Saldo de vendas</strong></td>
      ${monthTotals.map((item) => `<td class="right"><strong>${money.format(item.value)}</strong></td>`).join("")}
      <td class="right"><strong>${money.format(totalSales)}</strong></td>
    </tr>
    <tr>
      <td><strong>Sacos de cimento vendidos</strong></td>
      ${monthTotals.map((item) => `<td class="right"><strong>${formatQty(item.cementBags)}</strong></td>`).join("")}
      <td class="right"><strong>${formatQty(totalCementBags)}</strong></td>
    </tr>
    <tr>
      <td><strong>Preco medio por saco</strong></td>
      ${monthTotals.map((item) => `<td class="right"><strong>${money.format(item.cementBags ? item.value / item.cementBags : 0)}</strong></td>`).join("")}
      <td class="right"><strong>${money.format(totalCementBags ? totalSales / totalCementBags : 0)}</strong></td>
    </tr>
    <tr>
      <td><strong>Quantidade de pedidos</strong></td>
      ${monthTotals.map((item) => `<td class="right"><strong>${item.orders.toLocaleString("pt-BR")}</strong></td>`).join("")}
      <td class="right"><strong>${totalOrders.toLocaleString("pt-BR")}</strong></td>
    </tr>
  `;

  const sellerRows = sellers
    .filter((seller) => !sellerFilter || seller === sellerFilter)
    .map((seller) => {
      const monthValues = months.map((month) => {
        return state.orders
          .filter((order) => (order.salesperson || "NAO INFORMADO") === seller)
          .filter((order) => String(order.date || "").slice(0, 7) === month.key)
          .reduce((sum, order) => sum + Number(order.value || 0), 0);
      });
      const sellerOrders = state.orders.filter((order) => (order.salesperson || "NAO INFORMADO") === seller);
      const sellerBags = sellerOrders.reduce((sum, order) => sum + Number(order.qty || 0), 0);
      const sellerTotal = sellerOrders.reduce((sum, order) => sum + Number(order.value || 0), 0);
      return {
        seller,
        monthValues,
        bags: sellerBags,
        orders: sellerOrders.length,
        total: sellerTotal
      };
    })
    .sort((a, b) => b.total - a.total);

  qs("#seller-sales-count").textContent = `${sellerRows.length} vendedores`;
  qs("#seller-sales-table").innerHTML = sellerRows.length ? sellerRows.map((row) => `
    <tr>
      <td><strong>${row.seller}</strong></td>
      ${row.monthValues.map((value) => `<td class="right">${money.format(value)}</td>`).join("")}
      <td class="right">${formatQty(row.bags)}</td>
      <td class="right">${row.orders.toLocaleString("pt-BR")}</td>
      <td class="right"><strong>${money.format(row.total)}</strong></td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="7">Nenhuma venda encontrada para vendedores.</td>
    </tr>
  `;
}

function showReportTab(tabName) {
  qsa("[data-report-tab-button]").forEach((button) => {
    button.classList.toggle("active", button.dataset.reportTabButton === tabName);
  });
  qsa("[data-report-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.reportTabPanel !== tabName;
  });
}

function customerFromOrder(order) {
  const cleanDoc = cleanDocument(order.customerDoc || order.document || "");
  if (cleanDoc) {
    const byDocument = state.customers.find((customer) => cleanDocument(customer.document) === cleanDoc);
    if (byDocument) return byDocument;
  }
  const orderName = normalizeSearch(order.customer || "");
  return state.customers.find((customer) => normalizeSearch(customer.name || "") === orderName) || null;
}

function cityFromOrder(order) {
  const customer = customerFromOrder(order);
  const customerCity = customer ? customerCityText(customer) : "";
  if (customerCity) return customerCity;
  const city = destinationCity(customer, order.address || "");
  return city && city !== "-" ? city.replace(/\s*\/\s*[A-Z]{2}$/i, "") : "NAO INFORMADO";
}

function weightedAverageOrders() {
  const cityFilter = normalizeSearch(qs("#weighted-city-filter")?.value || "");
  const productFilters = String(qs("#weighted-product-filter")?.value || "")
    .split(/[;,]/)
    .map((item) => normalizeSearch(item))
    .filter(Boolean);
  const startFilter = qs("#weighted-start-filter")?.value || "";
  const endFilter = qs("#weighted-end-filter")?.value || "";
  return state.orders
    .flatMap((order) => {
      const orderCity = cityFromOrder(order);
      return orderItems(order).map((item) => {
        const qty = Number(item.qty || 0);
        const unitPrice = Number(item.price || 0);
        const total = Number(item.value || qty * unitPrice || 0);
        return {
        date: order.date || "",
        city: orderCity,
        product: item.product || order.product || "-",
        qty,
        unitPrice: unitPrice || (qty ? total / qty : 0),
        total,
        freightType: order.freightType || "entrega",
        freight: 0
      };
      });
    })
    .map((row) => ({ ...row, freight: freightValueForWeightedRow(row) }))
    .filter((row) => row.qty > 0)
    .filter((row) => !startFilter || row.date >= startFilter)
    .filter((row) => !endFilter || row.date <= endFilter)
    .filter((row) => !cityFilter || normalizeSearch(row.city).includes(cityFilter))
    .filter((row) => !productFilters.length || productFilters.some((productFilter) => normalizeSearch(row.product).includes(productFilter)));
}

function renderWeightedFilterOptions() {
  const cityDatalist = qs("#weighted-city-options");
  const productDatalist = qs("#weighted-product-options");
  if (!cityDatalist && !productDatalist) return;
  const cities = Array.from(new Set(state.orders
    .map(cityFromOrder)
    .filter((city) => city && city !== "-")))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (cityDatalist) cityDatalist.innerHTML = cities
    .map((city) => `<option value="${escapeAttr(city)}"></option>`)
    .join("");
  const products = Array.from(new Set(state.orders
    .flatMap((order) => orderItems(order).map((item) => item.product || order.product || ""))
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (productDatalist) productDatalist.innerHTML = products
    .map((product) => `<option value="${escapeAttr(product)}"></option>`)
    .join("");
}

function renderWeightedAverageReport() {
  const summaryTable = qs("#weighted-average-table");
  const detailTable = qs("#weighted-average-detail-table");
  if (!summaryTable || !detailTable) return;

  renderWeightedFilterOptions();
  const rows = weightedAverageOrders();
  const summary = weightedAverageSummaryRows(rows);

  const counter = qs("#weighted-average-count");
  if (counter) counter.textContent = `${summary.length} medias`;
  const detailCounter = qs("#weighted-detail-count");
  if (detailCounter) detailCounter.textContent = `${rows.length} vendas`;

  summaryTable.innerHTML = summary.length ? summary.map((row) => {
    const average = row.qty ? row.total / row.qty : 0;
    return `
      <tr>
        <td><strong>${escapeHtml(row.city)}</strong></td>
        <td>${escapeHtml(row.product)}</td>
        <td class="right">${formatQty(row.qty)}</td>
        <td class="right"><strong>${money.format(row.total)}</strong></td>
        <td class="right">${money.format(row.freight)}</td>
        <td class="right"><strong>${money.format(average)}</strong></td>
      </tr>
    `;
  }).join("") : `
    <tr>
      <td colspan="6">Nenhuma venda encontrada para os filtros selecionados.</td>
    </tr>
  `;

  detailTable.innerHTML = rows.length ? rows
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.city.localeCompare(b.city, "pt-BR"))
    .map((row) => `
      <tr>
        <td>${formatDateBR(row.date)}</td>
        <td>${escapeHtml(row.city)}</td>
        <td>${escapeHtml(row.product)}</td>
        <td class="right">${formatQty(row.qty)}</td>
        <td class="right">${money.format(row.unitPrice)}</td>
        <td class="right"><strong>${money.format(row.total)}</strong></td>
        <td class="right">${money.format(row.freight)}</td>
      </tr>
    `).join("") : `
    <tr>
      <td colspan="7">Nenhuma venda encontrada para conferir.</td>
    </tr>
  `;
}

function destinationCity(customer, address = "") {
  const city = String(customer?.city || "").trim();
  const uf = String(customer?.uf || "").trim();
  if (city) return uf ? `${city} / ${uf}` : city;

  const addressParts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const ufIndex = addressParts.findIndex((part) => /^[A-Z]{2}$/i.test(part));
  if (ufIndex > 0) return `${addressParts[ufIndex - 1]} / ${addressParts[ufIndex].toUpperCase()}`;
  if (addressParts.length >= 3) return addressParts[addressParts.length - 2];
  return "-";
}

function tripReportLoads() {
  const noteLoads = buildDailyLoadGroups(state.stockEntries.filter(isInvoiceStockEntry));
  const warehouseLoads = state.orders.filter(isWarehouseLoadOrder).map(buildWarehouseOrderLoad);
  return [...noteLoads, ...warehouseLoads].map((load) => {
    const entry = dailyLoadPrimaryEntry(load);
    const linkedOrderId = entry.generatedOrderId || entry.linkedOrderId || load.orderId || "";
    const order = linkedOrderId ? state.orders.find((item) => item.id === linkedOrderId) : null;
    const panelDate = load.isWarehouseOrder
      ? warehouseOrderPanelDate(order || {})
      : (entry.panelDate || entry.date);
    const driver = cleanDriverName(entry.loadedBy);
    const customer = order?.customerDoc ? findCustomer(order.customerDoc) : null;
    const destination = order
      ? order.customer
      : stockLocations.includes(entry.location)
        ? `Estoque ${entry.location}`
        : "Sem destino";
    const city = order
      ? destinationCity(customer, order.address)
      : stockLocations.includes(entry.location)
        ? entry.location
        : "-";
    return {
      date: panelDate,
      driver,
      destination,
      city,
      orderId: order?.id || linkedOrderId || "-",
      invoice: load.isWarehouseOrder ? "-" : (entry.invoice || "-"),
      product: load.products?.join(" / ") || entry.product || "-",
      quantity: load.quantity || entry.quantity || 0,
      origin: load.isWarehouseOrder ? `Estoque ${entry.location}` : (entry.invoice ? `NF ${entry.invoice}` : "-")
    };
  });
}

function renderTripReport() {
  renderDriverOptions();
  const monthFilter = qs("#trip-report-month")?.value || "";
  const dateFilter = qs("#trip-report-date")?.value || "";
  const driverFilter = normalizeSearch(qs("#trip-report-driver")?.value || "");
  const rows = tripReportLoads()
    .filter((item) => {
      const monthMatches = !monthFilter || String(item.date || "").startsWith(monthFilter);
      const dateMatches = !dateFilter || item.date === dateFilter;
      const driverMatches = !driverFilter || normalizeSearch(item.driver).includes(driverFilter);
      return monthMatches && dateMatches && driverMatches;
    })
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || normalizeSearch(a.driver).localeCompare(normalizeSearch(b.driver)));

  const counter = qs("#trip-report-count");
  if (counter) counter.textContent = `${rows.length} viagens`;
  const table = qs("#trip-report-table");
  if (!table) return;
  table.innerHTML = rows.length ? rows.map((item) => `
    <tr>
      <td>${formatDateBR(item.date)}</td>
      <td>${item.driver || "-"}</td>
      <td>${item.destination}</td>
      <td>${item.city || "-"}</td>
      <td><strong>${item.orderId}</strong></td>
      <td>${item.invoice}</td>
      <td>${item.product}</td>
      <td class="right">${formatQty(Number(item.quantity || 0))}</td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="8" class="center muted">Nenhuma viagem encontrada para os filtros selecionados.</td>
    </tr>
  `;
}

function freightTypeLabel(type) {
  return type === "retorno" ? "Retorno" : type === "galpao" ? "Galpao" : "Entrega";
}

function freightCityKey(city) {
  return plainCustomerText(String(city || "").split("/")[0].trim());
}

function freightTripRows() {
  const rows = [];
  const noteLoads = buildDailyLoadGroups(state.stockEntries.filter(isInvoiceStockEntry));

  noteLoads.forEach((load) => {
    const entry = dailyLoadPrimaryEntry(load);
    const date = entry.panelDate || entry.date;
    const driver = cleanDriverName(entry.loadedBy);
    const grouped = new Map();
    const addDestination = (key, data, quantity) => {
      if (!grouped.has(key)) grouped.set(key, { ...data, quantity: 0 });
      grouped.get(key).quantity += Number(quantity || 0);
    };

    load.entries.forEach((item) => {
      const allocations = entryAllocations(item);
      allocations.forEach((allocation) => {
        if (allocation.type === "order") {
          const order = state.orders.find((candidate) => candidate.id === allocation.orderId);
          if (!order) return;
          const customer = order.customerDoc ? findCustomer(order.customerDoc) : null;
          addDestination(`order:${order.id}`, {
            destination: order.customer,
            city: freightCityKey(destinationCity(customer, order.address)),
            orderId: order.id,
            invoice: entry.invoice || "-",
            defaultType: order.freightType === "retorno" ? "retorno" : "entrega"
          }, allocation.qty);
        }
        if (allocation.type === "stock" && stockLocations.includes(allocation.location)) {
          addDestination(`stock:${allocation.location}`, {
            destination: `Estoque ${allocation.location}`,
            city: allocation.location,
            orderId: "-",
            invoice: entry.invoice || "-",
            defaultType: "galpao"
          }, allocation.qty);
        }
      });

      if (!allocations.length) {
        const orderId = item.generatedOrderId || item.linkedOrderId;
        const order = orderId ? state.orders.find((candidate) => candidate.id === orderId) : null;
        if (order) {
          const customer = order.customerDoc ? findCustomer(order.customerDoc) : null;
          addDestination(`order:${order.id}`, {
            destination: order.customer,
            city: freightCityKey(destinationCity(customer, order.address)),
            orderId: order.id,
            invoice: entry.invoice || "-",
            defaultType: order.freightType === "retorno" ? "retorno" : "entrega"
          }, item.quantity);
        } else if (stockLocations.includes(item.location)) {
          addDestination(`stock:${item.location}`, {
            destination: `Estoque ${item.location}`,
            city: item.location,
            orderId: "-",
            invoice: entry.invoice || "-",
            defaultType: "galpao"
          }, item.quantity);
        }
      }
    });

    grouped.forEach((destination, destinationKey) => rows.push({
      ...destination,
      key: `${load.id}|${destinationKey}`,
      date,
      driver
    }));
  });

  state.orders.filter(isWarehouseLoadOrder).forEach((order) => {
    const customer = order.customerDoc ? findCustomer(order.customerDoc) : null;
    rows.push({
      key: `warehouse|${order.id}`,
      date: warehouseOrderPanelDate(order),
      driver: cleanDriverName(order.driver),
      destination: order.customer,
      city: freightCityKey(destinationCity(customer, order.address)),
      orderId: order.id,
      invoice: "-",
      quantity: Number(order.qty || 0),
      defaultType: order.freightType === "retorno" ? "retorno" : "entrega"
    });
  });

  return rows;
}

function freightRateFor(type, city) {
  return state.freightRates.find((rate) => rate.type === type
    && normalizeSearch(rate.city) === normalizeSearch(freightCityKey(city)));
}

function renderFreights() {
  const startDateInput = qs("#freight-date-start-filter");
  const endDateInput = qs("#freight-date-end-filter");
  if (!startDateInput || !endDateInput) return;
  if (!startDateInput.value) startDateInput.value = today;
  if (!endDateInput.value) endDateInput.value = today;
  const driverSelect = qs("#freight-driver-filter");
  const currentDriver = driverSelect.value || "";
  const drivers = driverOptions();
  driverSelect.innerHTML = [`<option value="">Todos os motoristas</option>`, ...drivers.map((driver) => `<option value="${escapeAttr(driver)}">${driver}</option>`)].join("");
  driverSelect.value = drivers.includes(currentDriver) ? currentDriver : "";

  const driverFilter = normalizeSearch(driverSelect.value);
  const rows = freightTripRows().filter((row) => row.date >= startDateInput.value && row.date <= endDateInput.value
    && (!driverFilter || normalizeSearch(row.driver).includes(driverFilter)));
  let total = 0;
  qs("#freight-count").textContent = `${rows.length} fretes`;
  qs("#freight-table").innerHTML = rows.length ? rows.map((row) => {
    const type = row.defaultType;
    const rate = freightRateFor(type, row.city);
    const unitValue = Number(rate?.value || 0);
    const value = unitValue * Number(row.quantity || 0);
    total += value;
    return `
      <tr>
        <td>${formatDateBR(row.date)}</td>
        <td><strong>${row.driver || "Nao informado"}</strong></td>
        <td><strong>${freightTypeLabel(type)}</strong></td>
        <td>${row.city || "-"}</td>
        <td>${row.destination || "-"}</td>
        <td>${row.orderId !== "-" ? `<button class="freight-order-link" type="button" data-freight-order="${escapeAttr(row.orderId)}">${row.orderId}</button>` : "-"}</td>
        <td>${row.invoice}</td>
        <td class="right">${formatQty(row.quantity)}</td>
        <td class="right"><strong>${rate ? money.format(value) : "Nao cadastrado"}</strong>${rate ? `<small class="freight-unit-value">${money.format(unitValue)} por saco</small>` : ""}</td>
      </tr>`;
  }).join("") : `<tr><td colspan="9" class="center muted">Nenhum frete encontrado para os filtros selecionados.</td></tr>`;
  qs("#freight-total").textContent = money.format(total);
}

function freightRateCities() {
  return Array.from(new Set([
    ...state.sellerCities.map((rule) => freightCityKey(rule.city)),
    ...state.customers.map((customer) => freightCityKey(customerCityText(customer))),
    ...freightTripRows().map((row) => freightCityKey(row.city)),
    ...state.freightRates.map((rate) => freightCityKey(rate.city)),
    ...stockLocations
  ].filter((city) => city && city !== "-"))).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function renderFreightSettings() {
  const table = qs("#freight-rates-table");
  if (!table) return;
  qsa("[data-freight-rate-tab]").forEach((button) => button.classList.toggle("active", button.dataset.freightRateTab === activeFreightRateType));
  qs("#freight-city-options").innerHTML = freightRateCities().map((city) => `<option value="${escapeAttr(city)}"></option>`).join("");
  const cityFilter = normalizeSearch(qs("#freight-rate-city-filter")?.value || "");
  const rates = state.freightRates
    .filter((rate) => rate.type === activeFreightRateType)
    .filter((rate) => !cityFilter || normalizeSearch(rate.city).includes(cityFilter))
    .sort((a, b) => a.city.localeCompare(b.city, "pt-BR"));
  qs("#freight-rates-count").textContent = `${rates.length} cidades`;
  table.innerHTML = rates.length ? rates.map((rate) => `
    <tr>
      <td><input class="settings-input" data-freight-rate-city="${rate.id}" value="${escapeAttr(rate.city)}" /></td>
      <td>${freightTypeLabel(rate.type)}</td>
      <td class="right"><input class="settings-input freight-value-input" data-freight-rate-value="${rate.id}" value="${Number(rate.value || 0).toFixed(2).replace(".", ",")}" /></td>
      <td class="right"><button class="stage-btn" type="button" data-save-freight-rate="${rate.id}">Salvar</button> <button class="danger-btn" type="button" data-delete-freight-rate="${rate.id}">Excluir</button></td>
    </tr>`).join("") : `<tr><td colspan="4" class="center muted">Nenhum valor cadastrado para ${freightTypeLabel(activeFreightRateType)}.</td></tr>`;
}

function addFreightRate(city, value) {
  const cleanCity = freightCityKey(city);
  const amount = parseMoneyInput(value);
  if (!cleanCity || amount < 0) {
    showToast("Informe cidade e valor do frete.");
    return false;
  }
  const existing = state.freightRates.find((rate) => rate.type === activeFreightRateType && normalizeSearch(rate.city) === normalizeSearch(cleanCity));
  if (existing) existing.value = amount;
  else state.freightRates.push({ id: `frete-${Date.now()}`, type: activeFreightRateType, city: cleanCity, value: amount });
  saveState();
  renderAll();
  showConfigTab("fretes-config");
  showToast(existing ? "Valor do frete atualizado." : "Valor do frete cadastrado.");
  return true;
}

function saveFreightRate(rateId) {
  const rate = state.freightRates.find((item) => item.id === rateId);
  if (!rate) return;
  rate.city = freightCityKey(qs(`[data-freight-rate-city="${CSS.escape(rateId)}"]`)?.value || rate.city);
  rate.value = parseMoneyInput(qs(`[data-freight-rate-value="${CSS.escape(rateId)}"]`)?.value || rate.value);
  saveState();
  renderAll();
  showConfigTab("fretes-config");
  showToast("Frete alterado.");
}

function deleteFreightRate(rateId) {
  state.freightRates = state.freightRates.filter((rate) => rate.id !== rateId);
  saveState();
  renderAll();
  showConfigTab("fretes-config");
  showToast("Frete excluído.");
}

function normalizeDateForCompare(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetweenDates(startDate, endDate) {
  const startValue = normalizeDateForCompare(startDate);
  const endValue = normalizeDateForCompare(endDate);
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 9999;
  return Math.floor((end - start) / 86400000);
}

function buildRecentImportedNotes(daysBack = 4) {
  refreshToday();
  const notesByKey = new Map();
  const addNote = (note, noteIndex = -1) => {
    const noteNumber = note?.number || note?.invoice || note?.nf || note?.nota;
    if (!noteNumber) return;
    const issue = normalizeDateForCompare(note.issue || note.date || note.emissionDate || note.issueDateTime || note.importedAt || note.createdAt) || today;
    const age = daysBetweenDates(issue, today);
    if (age < 0 || age > daysBack) return;
    const key = `${noteNumber}|${normalizeSearch(note.supplier)}`;
    const current = notesByKey.get(key);
    notesByKey.set(key, {
      number: noteNumber,
      supplier: note.supplier || "-",
      issue,
      ovNumber: note.ovNumber || note.factoryOrder || current?.ovNumber || "-",
      destination: note.linkedOrderIds?.length
        ? `Pedidos ${note.linkedOrderIds.join(", ")}`
        : note.linkedOrderId
          ? `Pedido ${note.linkedOrderId}`
          : stockLocations.includes(note.location)
            ? `Estoque ${note.location}`
            : current?.destination || "Distribuicao pendente",
      items: Number(note.items || current?.items || 1),
      status: note.status || current?.status || "Importada",
      noteIndex
    });
  };

  (state.notes || []).forEach((note, index) => addNote(note, index));
  (state.stockEntries || []).filter((entry) => entry?.invoice && isInvoiceStockEntry(entry)).forEach((entry) => {
    if (!entry.invoice) return;
    const key = `${entry.invoice}|${normalizeSearch(entry.supplier)}`;
    const current = notesByKey.get(key);
    const allocations = entryAllocations(entry);
    const linkedOrders = [
      entry.linkedOrderId,
      entry.generatedOrderId,
      ...allocations.filter((allocation) => allocation.type === "order").map((allocation) => allocation.orderId)
    ].filter(Boolean);
    const stockDestinations = [
      entry.location,
      ...allocations.filter((allocation) => allocation.type === "stock").map((allocation) => allocation.location)
    ].filter((location) => stockLocations.includes(location));
    addNote({
      number: entry.invoice,
      supplier: entry.supplier || "-",
      issue: entry.date || entry.issue || entry.emissionDate || entry.importedAt || entry.createdAt || today,
      ovNumber: entry.ovNumber || entry.factoryOrder || "-",
      destination: linkedOrders.length
        ? `Pedidos ${[...new Set(linkedOrders)].join(", ")}`
        : stockDestinations.length
          ? `Estoque ${[...new Set(stockDestinations)].join(", ")}`
          : "Distribuicao pendente",
      items: (current?.items || 0) + (current ? 0 : state.stockEntries.filter((item) => item.invoice === entry.invoice && normalizeSearch(item.supplier) === normalizeSearch(entry.supplier)).length),
      status: entry.distributionStarted || linkedOrders.length || stockDestinations.length ? "Importada vinculada" : "Importada"
    }, current?.noteIndex ?? -1);
  });

  return [...notesByKey.values()].sort((a, b) => String(b.issue).localeCompare(String(a.issue)) || String(b.number).localeCompare(String(a.number)));
}

function renderNotes() {
  const recentNotes = buildRecentImportedNotes(4);
  qs("#notes-count").textContent = `${recentNotes.length} notas`;
  qs("#notes-table").innerHTML = recentNotes.length ? recentNotes.map((note) => `
    <tr>
      <td><strong>${note.number}</strong></td>
      <td>${note.supplier}</td>
      <td>${String(note.issue || "").split("-").reverse().join("/")}</td>
      <td>${note.ovNumber || "-"}</td>
      <td>${note.destination}</td>
      <td class="right">${note.items}</td>
      <td><span class="status ${statusClass(note.status)}">${note.status}</span></td>
      <td class="right"><button class="danger-btn" type="button" data-delete-note="${note.noteIndex}" data-delete-note-number="${note.number}" data-delete-note-supplier="${note.supplier}">Excluir</button></td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="8">Nenhuma nota importada.</td>
    </tr>
  `;
}

function renderActiveView(viewId = activeViewId) {
  switch (viewId) {
    case "dashboard":
      renderDashboard();
      break;
    case "estoque":
      renderStock();
      break;
    case "clientes":
      renderCustomers();
      break;
    case "produtos":
      renderProducts();
      break;
    case "pedidos":
      renderOrders();
      break;
    case "logistica":
      renderLogistics();
      break;
    case "fretes":
      renderFreights();
      break;
    case "financeiro":
      renderReceivables();
      renderFinancialAccounts();
      break;
    case "boletos":
      renderBoletoExportSummary();
      break;
    case "relatorios":
      renderSalesReport();
      renderWeightedAverageReport();
      break;
    case "notas":
      renderNotes();
      break;
    case "configuracoes":
      renderDashboardLockSettings();
      renderSalespeopleSettings();
      renderDriversSettings();
      renderSellerCitiesSettings();
      renderPaymentRulesSettings();
      renderFreightSettings();
      renderPaymentMethods();
      renderUsersSettings();
      renderConfigOrders();
      renderStockAdjustmentOptions();
      renderStockLockSettings();
      renderManualStockSettings();
      break;
    default:
      renderDashboard();
  }
}

function renderCommonFastParts() {
  renderCustomerOptions();
  renderSaleProductOptions();
  renderCustomerSalespersonOptions();
  renderPaymentMethods();
  renderDriverOptions();
}

function renderAll() {
  refreshToday();
  renderCommonFastParts();
  renderActiveView(activeViewId);
}

function addStock(productName, quantity, factory = "Fornecedor importado", batch = `NF-${Date.now().toString().slice(-5)}`, locationValue = "Divinopolis") {
  forgetDeletedProduct({ product: productName, factory });
  const found = findStockProductByName(productName);
  if (found) {
    changeProductLocationQty(found, locationValue, quantity);
    found.factory = found.factory || factory;
    found.batch = found.batch || batch;
  } else {
    const locations = makeEmptyLocations();
    locations[normalizeLocation(locationValue)] = quantity;
    state.stock.push({
      id: makeProductId(productName, factory),
      product: productName,
      factory,
      batch,
      qty: quantity,
      locations,
      min: 100
    });
  }
  state.movements.unshift({ date: today, op: `Entrada ${normalizeLocation(locationValue)}`, product: productName, qty: quantity });
  saveState();
}

function ensureStockProduct(productName, factory = "Fornecedor importado", batch = "") {
  forgetDeletedProduct({ product: productName, factory });
  let product = findStockProductByName(productName);
  if (!product) {
    product = {
      id: makeProductId(productName, factory),
      product: productName,
      factory,
      batch,
      qty: 0,
      locations: makeEmptyLocations(),
      min: 100
    };
    state.stock.push(product);
  } else {
    product.factory = product.factory || factory;
    product.batch = product.batch || batch;
    product.locations = product.locations || makeEmptyLocations();
    syncProductTotal(product);
  }
  return product;
}

function importedStockDuplicateKey(entry) {
  if (!entry || entry.movementType || entry.generatedOrderId || entry.linkedOrderId) return "";
  if (entryAllocations(entry).length) return "";
  return [
    cleanDocument(entry.invoice || entry.number || ""),
    normalizeSearch(entry.supplier || ""),
    normalizeSearch(entry.product || ""),
    Number(entry.quantity || 0),
    entry.date || "",
    normalizeLocation(entry.location || ""),
    normalizeSearch(entry.factoryOrder || ""),
    normalizeSearch(entry.loadedBy || "")
  ].join("|");
}

function cleanupDuplicateImportedStockEntries() {
  if (!Array.isArray(state.stockEntries) || !state.stockEntries.length) return false;
  const seen = new Set();
  let changed = false;
  const cleanedEntries = [];

  state.stockEntries.forEach((entry) => {
    const duplicateKey = importedStockDuplicateKey(entry);
    if (!duplicateKey || !seen.has(duplicateKey)) {
      if (duplicateKey) seen.add(duplicateKey);
      cleanedEntries.push(entry);
      return;
    }

    const product = findStockProductForEntry(entry);
    const quantity = Number(entry.quantity || 0);
    if (product && quantity > 0) {
      changeProductLocationQty(product, normalizeLocation(entry.location), -quantity);
    }
    changed = true;
  });

  if (changed) {
    state.stockEntries = cleanedEntries;
    (state.notes || []).forEach((note) => {
      if (!Array.isArray(note.linkedOrderIds)) return;
      note.linkedOrderIds = Array.from(new Set(note.linkedOrderIds));
    });
  }
  return changed;
}

function uniqueImportedNoteItems(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = [
      normalizeSearch(item.product || ""),
      normalizeSearch(item.brand || ""),
      Number(item.quantity || 0)
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function manualStockEntries() {
  return (state.stockEntries || []).filter((entry) => entry.movementType);
}

function manualStockNumber(invoice) {
  const match = String(invoice || "").match(/^MAN-(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

function formatManualStockDocument(number) {
  return `MAN-${String(Math.max(1, Number(number || 1))).padStart(2, "0")}`;
}

function syncManualStockSequence() {
  const maxNumber = manualStockEntries().reduce((max, entry) => Math.max(max, manualStockNumber(entry.invoice)), 0);
  state.manualStockSequence = Math.max(Number(state.manualStockSequence || 0), maxNumber);
}

function applyManualStockNumberMigration() {
  state.manualStockSequence = Number(state.manualStockSequence || 0);
  if (state.manualStockNumberVersion === "manual-stock-seq-v1") {
    syncManualStockSequence();
    return;
  }
  const entries = manualStockEntries()
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))
      || String(a.id || "").localeCompare(String(b.id || "")));
  entries.forEach((entry, index) => {
    entry.invoice = formatManualStockDocument(index + 1);
  });
  state.manualStockSequence = entries.length;
  state.manualStockNumberVersion = "manual-stock-seq-v1";
  if (entries.length) saveState();
}

function nextManualStockDocument() {
  syncManualStockSequence();
  state.manualStockSequence += 1;
  return formatManualStockDocument(state.manualStockSequence);
}

function handleManualStockMovement(event) {
  event.preventDefault();
  const date = qs("#manual-stock-date").value || today;
  const product = state.stock.find((item) => item.id === qs("#manual-stock-product").value);
  const location = normalizeLocation(qs("#manual-stock-location").value);
  const type = qs("#manual-stock-type").value;
  const quantity = Number(qs("#manual-stock-quantity").value);
  const reason = qs("#manual-stock-reason").value.trim() || "Lançamento manual";

  if (!product) {
    showToast("Selecione um produto cadastrado.");
    return;
  }
  if (!["entrada", "saida"].includes(type)) {
    showToast("Selecione entrada ou saida.");
    return;
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    showToast("Informe uma quantidade valida.");
    return;
  }
  if (!assertStockDateUnlocked(date, "salvar lancamento manual")) return;

  const currentQuantity = Number(product.locations?.[location] || 0);
  const signedQuantity = type === "entrada" ? quantity : -quantity;

  if (type === "saida" && currentQuantity < quantity) {
    showToast(`Saldo insuficiente em ${location}. Disponivel: ${formatQty(currentQuantity)}.`);
    return;
  }

  changeProductLocationQty(product, location, signedQuantity);
  const document = nextManualStockDocument();
  const entryId = `ENT-${document}-${Math.random().toString(16).slice(2, 6)}`;
  const movementLabel = type === "entrada" ? "Entrada manual" : "Saida manual";
  state.stockEntries.unshift({
    id: entryId,
    date,
    invoice: document,
    factoryOrder: reason,
    product: product.product,
    quantity: signedQuantity,
    requestedQuantity: quantity,
    movementType: type,
    brand: product.factory || "Lançamento manual",
    loadedBy: getLoggedUser()?.name || "Operador do sistema",
    supplier: reason,
    location
  });
  state.movements.unshift({
    sourceId: entryId,
    date,
    op: `${movementLabel} ${location}`,
    product: product.product,
    qty: signedQuantity
  });

  qs("#manual-stock-form").reset();
  qs("#manual-stock-date").value = today;
  qs("#manual-stock-panel").hidden = true;
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast(`${movementLabel} salvo.`);
}

function deleteManualStockMovement(entryId) {
  const entry = state.stockEntries.find((item) => item.id === entryId && item.movementType);
  if (!entry) return;
  const product = findStockProductForEntry(entry);
  if (!product) {
    showToast("Produto do lançamento nao encontrado.");
    return;
  }
  const location = normalizeLocation(entry.location);
  const quantity = Number(entry.quantity || 0);
  const currentQuantity = Number(product.locations?.[location] || 0);
  if (!assertStockDateUnlocked(entry.date, "excluir lancamento manual")) return;
  if (quantity > 0 && currentQuantity < quantity) {
    showToast("Nao e possivel excluir: o estorno deixaria o estoque negativo.");
    return;
  }
  if (!window.confirm(`Excluir o lançamento ${entry.invoice}?`)) return;

  changeProductLocationQty(product, location, -quantity);
  state.stockEntries = state.stockEntries.filter((item) => item.id !== entryId);
    const movementIndex = state.movements.findIndex((movement) => movement.sourceId === entryId
    || (!movement.sourceId
      && movement.date === entry.date
      && sameProductName(movement.product, entry.product)
      && Number(movement.qty || 0) === quantity
      && normalizeSearch(movement.op).includes("manual")));
  if (movementIndex >= 0) state.movements.splice(movementIndex, 1);
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast("Lançamento excluído e saldo estornado.");
}

function handleStockAdjustment(event) {
  event.preventDefault();
  const productId = qs("#adjust-stock-product").value;
  const product = state.stock.find((item) => item.id === productId);
  if (!product) {
    showToast("Selecione um produto para transferir.");
    return;
  }

  const origin = normalizeLocation(qs("#adjust-stock-origin").value);
  const destination = normalizeLocation(qs("#adjust-stock-destination").value);
  const quantity = Number(qs("#adjust-stock-quantity").value || 0);
  const reason = qs("#adjust-stock-reason").value.trim() || "Transferencia entre unidades";
  if (quantity <= 0) {
    showToast("Informe uma quantidade maior que zero.");
    return;
  }
  if (origin === destination) {
    showToast("A origem e o destino precisam ser diferentes.");
    return;
  }
  if (!assertStockDateUnlocked(today, "salvar transferencia de estoque")) return;

  if (Number(product.locations?.[origin] || 0) < quantity) {
    showToast("Saldo insuficiente na unidade de origem para fazer a transferencia.");
    return;
  }

  changeProductLocationQty(product, origin, -quantity);
  changeProductLocationQty(product, destination, quantity);
  const document = `TR-${Date.now().toString().slice(-6)}`;
  const operator = getLoggedUser()?.name || "Operador do sistema";
  state.stockEntries.unshift(
    {
      id: `ENT-${document}-DEST-${Math.random().toString(16).slice(2, 6)}`,
      date: today,
      invoice: document,
      factoryOrder: reason,
      product: product.product,
      quantity,
      brand: product.factory || "Transferencia",
      loadedBy: operator,
      supplier: `${reason} / Origem ${origin}`,
      location: destination
    },
    {
      id: `ENT-${document}-ORIG-${Math.random().toString(16).slice(2, 6)}`,
      date: today,
      invoice: document,
      factoryOrder: reason,
      product: product.product,
      quantity: -quantity,
      brand: product.factory || "Transferencia",
      loadedBy: operator,
      supplier: `${reason} / Destino ${destination}`,
      location: origin
    }
  );
  state.movements.unshift({
    date: today,
    op: `Transferencia ${origin} para ${destination}`,
    product: product.product,
    qty: quantity
  });

  qs("#stock-adjustment-form").reset();
  qs("#stock-adjustment-panel").hidden = true;
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast("Transferencia de estoque salva.");
}

function makeProductId(productName, factory) {
  const base = `${productName}-${factory}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let id = base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let suffix = 2;
  while (state.stock.some((item) => item.id === id)) {
    id = `${base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function productDeleteKeys(product) {
  if (!product) return [];
  return [
    product.id,
    `${normalizeSearch(product.product)}|${normalizeSearch(product.factory)}`
  ].filter(Boolean);
}

function isDeletedProduct(product, keys = state.deletedProductKeys) {
  const deletedKeys = new Set(Array.isArray(keys) ? keys : []);
  return productDeleteKeys(product).some((key) => deletedKeys.has(key));
}

function rememberDeletedProduct(product) {
  state.deletedProductKeys = Array.isArray(state.deletedProductKeys) ? state.deletedProductKeys : [];
  const keys = new Set(state.deletedProductKeys);
  productDeleteKeys(product).forEach((key) => keys.add(key));
  state.deletedProductKeys = [...keys];
}

function forgetDeletedProduct(product) {
  if (!Array.isArray(state.deletedProductKeys)) return;
  const keys = new Set(productDeleteKeys(product));
  state.deletedProductKeys = state.deletedProductKeys.filter((key) => !keys.has(key));
}

function resetCustomerForm() {
  editingCustomerDocument = "";
  qs("#customer-form").reset();
  renderCustomerSalespersonOptions("");
  renderCustomerPaymentOptions("");
  renderCustomerPaymentTermOptions("");
  qs("#customer-form-title").textContent = "Cadastro de cliente";
  qs("#customer-edit-tag").textContent = "Novo";
  qs("#customer-submit-btn").textContent = "Salvar cliente";
}

function startEditCustomer(documentValue) {
  const customer = findCustomer(documentValue);
  if (!customer) return;
  const form = qs("#customer-form");

  editingCustomerDocument = customer.document;
  form.elements.document.value = formatDocument(customer.document);
  form.elements.name.value = customer.name;
  if (form.elements.fantasy) form.elements.fantasy.value = customer.fantasy || "";
  form.elements.address.value = customer.address || "";
  form.elements.phone.value = customer.phone || "";
  renderCustomerSalespersonOptions(resolveCustomerSalesperson(customer));
  renderCustomerPaymentOptions(customer.payment || "");
  renderCustomerPaymentTermOptions(customer.paymentTerm || "");
  qs("#customer-form-title").textContent = "Editar cliente";
  qs("#customer-edit-tag").textContent = "Editando";
  qs("#customer-submit-btn").textContent = "Salvar alterações";
  qs('[data-view="clientes"]').click();
  qs("#customer-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function fillCustomerRegisterForm(customer) {
  const form = qs("#customer-form");
  form.elements.document.value = formatDocument(customer.document);
  form.elements.name.value = customer.name || "";
  if (form.elements.fantasy) form.elements.fantasy.value = customer.fantasy || "";
  form.elements.address.value = customer.address || "";
  form.elements.phone.value = customer.phone || "";
  renderCustomerSalespersonOptions(resolveCustomerSalesperson(customer));
  renderCustomerPaymentOptions(customer.payment || "");
  renderCustomerPaymentTermOptions(customer.paymentTerm || "");
}

async function lookupCustomerRegister() {
  const form = qs("#customer-form");
  const doc = cleanDocument(form.elements.document.value);
  if (![11, 14].includes(doc.length)) {
    showToast("Digite CPF ou CNPJ completo, somente numeros.");
    return;
  }

  let customer = findCustomer(doc);
  if (!customer && receitaMock[doc]) {
    customer = upsertCustomer({ document: doc, ...receitaMock[doc] });
  }

  const button = qs("#lookup-customer-register-btn");
  if (!customer && doc.length === 14) {
    button.disabled = true;
    button.textContent = "Buscando";
    try {
      customer = upsertCustomer(await fetchCnpjData(doc));
    } catch (error) {
      showToast("CNPJ nao encontrado na consulta. Confira o numero.");
      return;
    } finally {
      button.disabled = false;
      button.textContent = "Buscar dados";
    }
  }

  if (!customer && doc.length === 11) {
    showToast("CPF nao possui consulta publica da Receita. Preencha ou importe os dados.");
    return;
  }

  fillCustomerRegisterForm(customer);
  saveState();
  renderCustomers();
  renderCustomerOptions(customer.document);
  showToast("Dados do cliente preenchidos no cadastro.");
}

function resetProductForm() {
  editingProductId = "";
  qs("#product-form").reset();
  qs("#product-form-title").textContent = "Cadastro de produto";
  qs("#product-edit-tag").textContent = "Novo";
  qs("#product-submit-btn").textContent = "Salvar produto";
}

function startEditProduct(productId) {
  const product = state.stock.find((item) => item.id === productId);
  if (!product) return;
  const form = qs("#product-form");

  editingProductId = productId;
  form.elements.product.value = product.product;
  form.elements.factory.value = product.factory;
  form.elements.batch.value = product.batch;
  form.elements.qty.value = product.qty;
  form.elements.min.value = product.min;
  qs("#product-form-title").textContent = `Editar produto`;
  qs("#product-edit-tag").textContent = "Editando";
  qs("#product-submit-btn").textContent = "Salvar alterações";
  qs('[data-view="produtos"]').click();
  qs("#product-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteProduct(productId) {
  const product = state.stock.find((item) => item.id === productId);
  if (!product) return;
  const usedInOrder = state.orders.some((order) => orderItems(order).some((item) => item.productId === productId || sameProductName(item.product, product.product)));
  if (usedInOrder) {
    showToast("Nao e possivel excluir: produto ja usado em pedido.");
    return;
  }
  rememberDeletedProduct(product);
  state.stock = state.stock.filter((item) => item.id !== productId);
  state.stockEntries = state.stockEntries.filter((entry) => !sameProductName(entry.product, product.product));
  state.movements = state.movements.filter((movement) => !sameProductName(movement.product, product.product));
  if (editingProductId === productId) resetProductForm();
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast("Produto excluído.");
}

function handleCustomerForm(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const documentValue = cleanDocument(data.get("document"));
  const name = String(data.get("name")).trim();
  const fantasy = String(data.get("fantasy") || "").trim();
  const address = String(data.get("address")).trim();
  const phone = String(data.get("phone")).trim();
  const customerSalesperson = state.salespeople.includes(data.get("customerSalesperson")) ? data.get("customerSalesperson") : "";
  const customerPayment = state.paymentMethods.includes(data.get("customerPayment")) ? data.get("customerPayment") : "";
  const customerPaymentTerm = plainCustomerText(data.get("customerPaymentTerm") || "");
  if (![11, 14].includes(documentValue.length)) {
    showToast("Informe CPF ou CNPJ valido.");
    return;
  }

  if (customerPaymentTerm && !customerPayment) {
    showToast("Selecione a forma de pagamento do cliente.");
    return;
  }

  if (editingCustomerDocument) {
    const customer = findCustomer(editingCustomerDocument);
    if (!customer) {
      resetCustomerForm();
      showToast("Cliente nao encontrado para edicao.");
      return;
    }

    const duplicate = state.customers.find((item) => {
      return item.document !== editingCustomerDocument && item.document === documentValue;
    });

    if (duplicate) {
      showToast("Ja existe outro cliente com esse CPF/CNPJ.");
      return;
    }

    const oldDocument = customer.document;
    const oldName = customer.name;
    customer.document = documentValue;
    customer.name = name;
    customer.fantasy = plainCustomerText(fantasy);
    customer.address = address;
    customer.phone = phone;
    customer.salesperson = customerSalesperson;
    customer.payment = customerPayment;
    customer.paymentTerm = customerPaymentTerm;
    customer.lastPrices = customer.lastPrices || {};

    state.orders.forEach((order) => {
      if (order.customerDoc === oldDocument) {
        order.customerDoc = customer.document;
        order.customer = customer.name;
        order.address = customer.address;
        order.phone = customer.phone;
      }
    });

    state.receivables.forEach((receivable) => {
      const order = state.orders.find((item) => item.id === receivable.origin);
      if (order?.customerDoc === customer.document || receivable.customer === oldName) {
        receivable.customer = customer.name;
      }
    });

    resetCustomerForm();
    saveState();
    renderAll();
    showToast("Cliente atualizado.");
    return;
  }

  upsertCustomer({
    document: documentValue,
    name,
    fantasy,
    address,
    phone,
    salesperson: customerSalesperson,
    payment: customerPayment,
    paymentTerm: customerPaymentTerm
  });
  resetCustomerForm();
  saveState();
  renderAll();
  showToast("Cliente salvo.");
}

function deleteCustomer(documentValue) {
  const customer = findCustomer(documentValue);
  if (!customer) return;
  const hasOrders = state.orders.some((order) => order.customerDoc === customer.document);
  const message = hasOrders
    ? `Excluir ${customer.name}? Os pedidos antigos continuam registrados no historico.`
    : `Excluir ${customer.name}?`;
  if (!window.confirm(message)) return;
  state.customers = state.customers.filter((item) => item.document !== customer.document);
  if (editingCustomerDocument === customer.document) resetCustomerForm();
  saveState();
  renderAll();
  showToast("Cliente excluído.");
}

function updateCustomerSalesperson(documentValue, salesperson) {
  const customer = findCustomer(documentValue);
  if (!customer) return;
  customer.salesperson = state.salespeople.includes(salesperson) ? salesperson : "";
  saveState();
  renderCustomers();
  showToast(customer.salesperson ? "Vendedor do cliente alterado." : "Cliente voltou para vendedor automatico pela cidade.");
}

function normalizeCustomerFormInput(event) {
  const input = event.target.closest('[name="name"], [name="fantasy"], [name="address"]');
  if (!input) return;
  const cursor = input.selectionStart;
  const normalized = String(input.value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (input.value === normalized) return;
  input.value = normalized;
  const nextCursor = Math.min(cursor || normalized.length, normalized.length);
  input.setSelectionRange(nextCursor, nextCursor);
}

function clearCustomers() {
  if (!state.customers.length) {
    showToast("Nao ha clientes cadastrados para apagar.");
    return false;
  }

  const hasOrders = state.orders.some((order) => order.customerDoc);
  const message = hasOrders
    ? "Apagar todos os clientes cadastrados? Os pedidos antigos continuam no historico."
    : "Apagar todos os clientes cadastrados?";
  if (!window.confirm(message)) return false;

  state.customers = [];
  activeCustomerSearch = "";
  qs("#customers-search").value = "";
  qs("#customers-city-filter").value = "";
  qs("#customers-seller-filter").value = "";
  resetCustomerForm();
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast("Clientes apagados.");
  return true;
}

function splitImportLine(line, separator) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === separator && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function normalizeImportKey(value) {
  const key = normalizeSearch(value);
  if (key.includes("cpf") || key.includes("cnpj") || key.includes("document")) return "document";
  if (key.includes("nome") || key.includes("razao") || key.includes("cliente")) return "name";
  if (key.includes("endereco") || key.includes("address")) return "address";
  if (key.includes("telefone") || key.includes("whatsapp") || key.includes("phone")) return "phone";
  return "";
}

function parseCustomersImport(text, fileName = "") {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (fileName.toLowerCase().endsWith(".json") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed);
    return Array.isArray(data) ? data : [];
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const firstLine = lines[0] || "";
  const separator = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
  const firstValues = splitImportLine(firstLine, separator);
  const keys = firstValues.map(normalizeImportKey);
  const hasHeader = keys.some(Boolean);
  const headers = hasHeader ? keys : ["document", "name", "address", "phone"];
  const rows = hasHeader ? lines.slice(1) : lines;

  return rows.map((line) => {
    const values = splitImportLine(line, separator);
    return headers.reduce((customer, key, index) => {
      if (key) customer[key] = values[index] || "";
      return customer;
    }, {});
  });
}

async function importCustomersFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const customers = parseCustomersImport(await file.text(), file.name);
    const replaceCustomers = customerImportMode === "replace";
    if (replaceCustomers && state.customers.length) {
      const confirmed = window.confirm("Substituir todos os clientes cadastrados pelos clientes deste CSV?");
      if (!confirmed) return;
      state.customers = [];
      activeCustomerSearch = "";
      qs("#customers-search").value = "";
      resetCustomerForm();
    }
    let imported = 0;
    customers.forEach((customer) => {
      const documentValue = cleanDocument(customer.document || customer.cpf || customer.cnpj || "");
      const name = String(customer.name || customer.nome || customer.razaoSocial || "").trim();
      if (![11, 14].includes(documentValue.length) || !name) return;
      upsertCustomer({
        document: documentValue,
        name,
        address: customer.address || customer.endereco || "",
        phone: customer.phone || customer.telefone || customer.whatsapp || ""
      });
      imported += 1;
    });
    saveState();
    saveStateToCloudNow();
    renderAll();
    showToast(replaceCustomers ? `${imported} clientes cadastrados no novo CSV.` : `${imported} clientes importados.`);
  } catch (error) {
    showToast("Nao foi possivel importar o arquivo de clientes.");
  } finally {
    customerImportMode = "merge";
    event.target.value = "";
  }
}

function handleProductForm(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const productName = String(data.get("product")).trim();
  const factory = String(data.get("factory")).trim();
  const batch = String(data.get("batch")).trim() || `CAD-${Date.now().toString().slice(-4)}`;
  const qty = Number(data.get("qty"));
  const min = Number(data.get("min"));

  if (editingProductId) {
    const product = state.stock.find((item) => item.id === editingProductId);
    if (!product) {
      resetProductForm();
      showToast("Produto nao encontrado para edicao.");
      return;
    }

    const duplicate = state.stock.find((item) => {
      return item.id !== editingProductId
        && item.product.toLowerCase() === productName.toLowerCase()
        && item.factory.toLowerCase() === factory.toLowerCase();
    });

    if (duplicate) {
      showToast("Ja existe outro produto com esse nome e marca.");
      return;
    }

    const oldProductName = product.product;
    const oldFactory = product.factory;
    product.product = productName;
    product.factory = factory;
    product.batch = batch;
    product.locations = { ...makeEmptyLocations(), "Divinopolis": qty };
    syncProductTotal(product);
    product.min = min;

    state.orders.forEach((order) => {
      if (order.productId === product.id) {
        order.product = productName;
      }
    });

    state.stockEntries.forEach((entry) => {
      if (entry.product === oldProductName) {
        entry.product = productName;
        if (entry.brand === oldFactory) entry.brand = factory;
        if (entry.supplier === oldFactory) entry.supplier = factory;
      }
    });

    state.movements.forEach((movement) => {
      if (movement.product === oldProductName) {
        movement.product = productName;
      }
    });

    resetProductForm();
    saveState();
    renderAll();
    showToast("Produto atualizado.");
    return;
  }

  const existing = state.stock.find((item) => {
    return item.product.toLowerCase() === productName.toLowerCase() && item.factory.toLowerCase() === factory.toLowerCase();
  });

  if (existing) {
    forgetDeletedProduct(existing);
    existing.batch = batch;
    changeProductLocationQty(existing, "Divinopolis", qty);
    existing.min = min;
  } else {
    forgetDeletedProduct({ product: productName, factory });
    const locations = makeEmptyLocations();
    locations["Divinopolis"] = qty;
    state.stock.push({
      id: makeProductId(productName, factory),
      product: productName,
      factory,
      batch,
      qty,
      locations,
      min
    });
  }

  if (qty > 0) {
    state.stockEntries.unshift({
      date: today,
      invoice: "CADASTRO",
      factoryOrder: "Saldo inicial",
      product: productName,
      quantity: qty,
      brand: factory,
      loadedBy: "Cadastro de produto",
      supplier: factory,
      location: "Divinopolis"
    });
  }

  event.currentTarget.reset();
  saveState();
  renderAll();
  showToast("Produto salvo.");
}

function detectBrand(productName, supplier = "") {
  const text = `${productName} ${supplier}`.toLowerCase();
  if (text.includes("votor")) return "Votorantim";
  if (text.includes("nacional")) return "Nacional";
  if (text.includes("centro sul")) return "Centro Sul";
  if (text.includes("fortemix")) return "ForteMix";
  const brandMatch = productName.match(/marca\s+(.+)$/i);
  return brandMatch ? brandMatch[1].trim() : supplier || "Nao informado";
}

function cleanDocument(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatDocument(value) {
  const doc = cleanDocument(value);
  if (doc.length === 11) {
    return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (doc.length === 14) {
    return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return value || "";
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cleanDriverName(value) {
  return String(value || "")
    .replace(/^(motorista|carregado por|quem carregou|condutor)\s*[:\-]?\s*/i, "")
    .replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulDriverName(value) {
  const name = cleanDriverName(value);
  if (!name) return false;
  const normalized = normalizeSearch(name);
  if (["fiscal", "nao informado", "nao informado.", "operador do sistema"].includes(normalized)) return false;
  return name.split(/\s+/).filter(Boolean).length >= 2;
}

function cleanDriverOptions(values) {
  const cleaned = (values || [])
    .map((value) => cleanDriverName(value))
    .filter(isUsefulDriverName);
  const byKey = new Map();
  cleaned.forEach((name) => {
    const key = normalizeSearch(name);
    const current = byKey.get(key);
    if (!current || name.length > current.length) byKey.set(key, name);
  });
  return Array.from(byKey.values())
    .sort((a, b) => normalizeSearch(a).localeCompare(normalizeSearch(b)));
}

function cleanOvNumber(value) {
  const digits = String(value || "").match(/\d{3,}/);
  return digits ? digits[0] : "";
}

function extractDriverName(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const match = text.match(/(?:nome\s+do\s+motorista|motorista|condutor)\s*[:\-]?\s+(.+?)(?=\s+ref\.?\s*cliente|\s+cliente|\s+cpf|\s+cnpj|\s+placa|\s+incide|\s+regulamento|\s+decreto|\s*$)/i);
  return cleanDriverName(match?.[1] || "");
}

function pickObservationValue(text, labels) {
  const normalizedText = String(text || "").replace(/\s+/g, " ");
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:\\-]?\\s*([^;|\\n\\r]+)`, "i");
    const match = normalizedText.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function extractNoteMetadata(observationText) {
  const text = String(observationText || "");
  const ovNumberRaw =
    pickObservationValue(text, ["numero ovs", "numero ovs", "numero ov", "numero ov", "ovs", "ov"])
    || text.match(/\bOVS?[-\s:]?([A-Z0-9./-]+)/i)?.[1]
    || "";
  const loadedBy = extractDriverName(text);

  return {
    observation: text,
    ovNumber: cleanOvNumber(ovNumberRaw),
    loadedBy: cleanDriverName(loadedBy)
  };
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeProductKey(value) {
  return normalizeSearch(value)
    .replace(/\b\d+(?:[.,]\d+)?\s*sacos?\b/g, "")
    .replace(/\btonelada\b/g, "ton")
    .replace(/tona/g, "ton")
    .replace(/[^a-z0-9]/g, "");
}

function sameProductName(first, second) {
  const firstKey = normalizeProductKey(first);
  const secondKey = normalizeProductKey(second);
  return Boolean(firstKey && secondKey && firstKey === secondKey);
}

function findStockProductByName(productName) {
  return state.stock.find((product) => sameProductName(product.product, productName))
    || state.stock.find((product) => normalizeSearch(product.product) === normalizeSearch(productName));
}

function plainCustomerText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function extractPaymentTerm(value) {
  const text = plainCustomerText(value);
  if (!/\d/.test(text)) return "";
  if (!/(PRAZO|DIA|DIAS|\/)/.test(text)) return "";
  return text
    .replace(/\bPRAZO\b/g, "")
    .replace(/\bDIAS?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCustomerRecord(customer) {
  if (!customer) return customer;
  ["name", "fantasy", "address", "street", "number", "complement", "neighborhood", "city", "uf", "zip", "paymentTerm"].forEach((field) => {
    const oldValue = customer[field] || "";
    const newValue = plainCustomerText(oldValue);
    if (oldValue && oldValue !== newValue) customersTextNormalized = true;
    customer[field] = newValue;
  });
  return customer;
}

function applyDefaultSellerCitiesIfNeeded() {
  const version = "seller-cities-edmilson-edson-2026-06-19-v2";
  if (state.defaultSellerCitiesVersion === version) return false;
  const existingCities = [];

  const rules = [
    {
      salesperson: "Edmilson",
      cities: [
        "Aguanil",
        "Boa Esperanca",
        "Bom Sucesso",
        "Campo Belo",
        "Cana Verde",
        "Candeias",
        "Carrancas",
        "Coqueiral",
        "Cristais",
        "Ibituruna",
        "Ijaci",
        "Ilicinea",
        "Ingai",
        "Itumirim",
        "Itutinga",
        "Lavras",
        "Luminarias",
        "Nepomuceno",
        "Perdoes",
        "Ribeirao Vermelho",
        "Santana da Vargem",
        "Santana do Jacare",
        "Santo Antonio do Amparo",
        "Tres Pontas",
        "Alpinopolis",
        "Arceburgo",
        "Bom Jesus da Penha",
        "Cabo Verde",
        "Capetinga",
        "Capitolio",
        "Carmo do Rio Claro",
        "Cassia",
        "Claraval",
        "Delfinopolis",
        "Doresopolis",
        "Fortaleza de Minas",
        "Guape",
        "Guaranesia",
        "Guaxupe",
        "Ibiraci",
        "Itamogi",
        "Itau de Minas",
        "Jacui",
        "Juruaia",
        "Monte Belo",
        "Monte Santo de Minas",
        "Muzambinho",
        "Nova Resende",
        "Passos",
        "Piumhi",
        "Pratapolis",
        "Sao Joao Batista do Gloria",
        "Sao Jose da Barra",
        "Sao Pedro da Uniao",
        "Sao Roque de Minas",
        "Sao Sebastiao do Paraiso",
        "Sao Tomas de Aquino",
        "Vargem Bonita"
      ]
    },
    {
      salesperson: "Edson",
      cities: [
        "Abaete",
        "Biquinhas",
        "Bom Despacho",
        "Cedro do Abaete",
        "Dores do Indaia",
        "Estrela do Indaia",
        "Luz",
        "Martinho Campos",
        "Moema",
        "Morada Nova de Minas",
        "Paineiras",
        "Pompeu",
        "Quartel Geral",
        "Serra da Saudade",
        "Arcos",
        "Bonfim",
        "Carmo da Mata",
        "Carmopolis de Minas",
        "Claudio",
        "Crucilandia",
        "Itaguara",
        "Itapecerica",
        "Itatiaiucu",
        "Japaraiba",
        "Lagoa da Prata",
        "Oliveira",
        "Passa Tempo",
        "Pedra do Indaia",
        "Piedade dos Gerais",
        "Piracema",
        "Rio Manso",
        "Santo Antonio do Monte",
        "Sao Francisco de Paula"
      ]
    }
  ];

  rules.forEach((group) => {
    const salesperson = state.salespeople.find((seller) => normalizeSearch(seller) === normalizeSearch(group.salesperson)) || group.salesperson;
    group.cities.forEach((city) => {
      const cleanCity = plainCustomerText(city);
      const existing = state.sellerCities.find((rule) => normalizeSearch(rule.city) === normalizeSearch(cleanCity) && normalizeSearch(rule.uf || "MG") === "mg");
      if (existing) {
        existingCities.push(`${cleanCity} - ${existing.salesperson || "sem vendedor"} > ${salesperson}`);
        existing.city = cleanCity;
        existing.uf = "MG";
        existing.salesperson = salesperson;
        return;
      }
      state.sellerCities.push({
        id: `cidade-${Date.now()}-${state.sellerCities.length}`,
        city: cleanCity,
        uf: "MG",
        salesperson
      });
    });
  });
  state.defaultSellerCitiesExistingReport = existingCities;
  state.defaultSellerCitiesVersion = version;
  localStorage.setItem("cimentoGestorState", JSON.stringify(state));
  return true;
}

function restoreDouglasSellerCitiesFromCustomers() {
  const version = "seller-cities-douglas-from-customers-2026-07-01-v1";
  if (state.douglasSellerCitiesVersion === version) return false;
  const douglas = state.salespeople.find((seller) => normalizeSearch(seller) === "douglas");
  if (!douglas) return false;
  let added = 0;
  state.customers.forEach((customer) => {
    if (normalizeSearch(customer.salesperson) !== "douglas") return;
    const cleanCity = plainCustomerText(customerCityText(customer));
    if (!cleanCity || cleanCity === "-") return;
    const cleanUf = plainCustomerText(customer.uf || "MG").toUpperCase() || "MG";
    const exists = state.sellerCities.some((rule) => (
      normalizeSearch(rule.city) === normalizeSearch(cleanCity)
      && normalizeSearch(rule.uf || "MG") === normalizeSearch(cleanUf)
    ));
    if (exists) return;
    state.sellerCities.push({
      id: `cidade-douglas-${Date.now()}-${state.sellerCities.length}`,
      city: cleanCity,
      uf: cleanUf,
      salesperson: douglas
    });
    added += 1;
  });
  state.douglasSellerCitiesVersion = version;
  if (added) localStorage.setItem("cimentoGestorState", JSON.stringify(state));
  return added > 0;
}

function removeLegacyDivinopolisEdmilsonAssignments() {
  const version = "remove-divinopolis-edmilson-2026-07-13-v1";
  state.migrationVersions = state.migrationVersions || {};
  if (state.migrationVersions[version]) return false;

  const hasDivinopolisRule = state.sellerCities.some((rule) => (
    normalizeSearch(rule.city) === "divinopolis"
  ));
  let changed = false;

  if (!hasDivinopolisRule) {
    state.customers.forEach((customer) => {
      const isDivinopolis = normalizeSearch(customerCityText(customer)) === "divinopolis";
      const isEdmilson = normalizeSearch(customer.salesperson) === "edmilson";
      if (!isDivinopolis || !isEdmilson) return;
      customer.salesperson = "";
      changed = true;
    });
  }

  state.migrationVersions[version] = true;
  return changed;
}

function upsertPaymentRule(type, reference, payment, term, document = "") {
  const cleanReference = plainCustomerText(reference);
  const cleanDoc = cleanDocument(document);
  if (!cleanReference || !payment || !term) return;
  const existing = state.paymentRules.find((rule) => {
    if (type === "customer" && cleanDoc) return rule.type === type && rule.document === cleanDoc;
    return rule.type === type && normalizeSearch(rule.reference) === normalizeSearch(cleanReference);
  });
  if (existing) {
    existing.reference = cleanReference;
    existing.document = cleanDoc || existing.document || "";
    existing.payment = payment;
    existing.term = plainCustomerText(term);
    return;
  }
  state.paymentRules.push({
    id: `prazo-${Date.now()}-${state.paymentRules.length}`,
    type,
    reference: cleanReference,
    document: cleanDoc,
    payment,
    term: plainCustomerText(term)
  });
}

function applyDefaultPaymentRulesIfNeeded() {
  const version = "payment-rules-divinopolis-edmilson-2026-06-19-v1";
  if (state.defaultPaymentRulesVersion === version) return false;
  upsertPaymentRule("city", "Divinopolis", "Boleto", "15");
  upsertPaymentRule("seller", "Edmilson", "Boleto", "21/28/35");
  state.defaultPaymentRulesVersion = version;
  localStorage.setItem("cimentoGestorState", JSON.stringify(state));
  return true;
}

function findCustomer(documentValue) {
  const doc = cleanDocument(documentValue);
  return state.customers.find((customer) => customer.document === doc);
}

function findCustomerByTerm(termValue) {
  const term = normalizeSearch(termValue);
  const doc = cleanDocument(termValue);
  if (!term && !doc) return null;

  const saved = state.customers.find((customer) => {
    return customer.document === doc || customerMatchesSearch(customer, term);
  });
  if (saved) return saved;

  const receitaEntry = Object.entries(receitaMock).find(([document, customer]) => {
    return document === doc || customerMatchesSearch({ document, ...customer }, term);
  });
  if (!receitaEntry) return null;

  const [document, customer] = receitaEntry;
  return upsertCustomer({ document, ...customer });
}

async function fetchCnpjData(cnpj) {
  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!response.ok) {
    throw new Error("CNPJ nao encontrado.");
  }

  const data = await response.json();
  const address = [
    data.descricao_tipo_de_logradouro,
    data.logradouro,
    data.numero,
    data.complemento,
    data.bairro,
    data.municipio,
    data.uf,
    data.cep ? `CEP ${data.cep}` : ""
  ].filter(Boolean).join(", ");

  return {
    document: cnpj,
    name: data.razao_social || data.nome_fantasia || "",
    address,
    phone: data.ddd_telefone_1 || data.ddd_telefone_2 || "",
    city: data.municipio || "",
    uf: data.uf || ""
  };
}

function upsertCustomer(data) {
  const documentValue = cleanDocument(data.document);
  let customer = state.customers.find((item) => item.document === documentValue);
  if (!customer) {
    customer = { document: documentValue, name: "", address: "", phone: "", lastPrices: {} };
    state.customers.push(customer);
  }
  customer.name = plainCustomerText(data.name || customer.name);
  customer.fantasy = plainCustomerText(data.fantasy || customer.fantasy || "");
  customer.address = plainCustomerText(data.address || customer.address);
  customer.phone = data.phone || customer.phone;
  customer.street = plainCustomerText(data.street || customer.street || "");
  customer.number = plainCustomerText(data.number || customer.number || "");
  customer.complement = plainCustomerText(data.complement || customer.complement || "");
  customer.neighborhood = plainCustomerText(data.neighborhood || customer.neighborhood || "");
  customer.zip = plainCustomerText(data.zip || customer.zip || "");
  customer.city = plainCustomerText(data.city || customer.city || "");
  customer.uf = plainCustomerText(data.uf || customer.uf || "");
  customer.salesperson = state.salespeople.includes(data.salesperson) ? data.salesperson : customer.salesperson || "";
  customer.payment = state.paymentMethods.includes(data.payment) ? data.payment : customer.payment || "";
  customer.paymentTerm = plainCustomerText(data.paymentTerm || customer.paymentTerm || "");
  customer.lastPrices = data.lastPrices || customer.lastPrices || {};
  return normalizeCustomerRecord(customer);
}

function fillCustomer(customer) {
  qs("#customer-search").value = `${customer.name} - ${formatDocument(customer.document)}`;
  qs("#customer-document").value = formatDocument(customer.document);
  qs("#customer-name").value = customer.name || "";
  qs("#customer-address").value = customer.address || "";
  qs("#customer-phone").value = customer.phone || "";
  applySaleSalesperson(customer);
  applyPaymentRuleForCustomer(customer);
  updateDirectLoadDestinationMode();
  const results = qs("#customer-search-results");
  if (results) {
    results.hidden = true;
    results.innerHTML = "";
  }
  applyLastPrice();
}

async function lookupCustomer() {
  const searchTerm = qs("#customer-search").value || qs("#customer-document").value || qs("#customer-name").value;
  const doc = cleanDocument(searchTerm);
  let customer = findCustomerByTerm(searchTerm);

  if (!customer && doc.length === 14) {
    const button = qs("#lookup-customer-btn");
    button.disabled = true;
    button.textContent = "Buscando";
    try {
      const cnpjData = await fetchCnpjData(doc);
      customer = upsertCustomer(cnpjData);
    } catch (error) {
      const fallback = receitaMock[doc];
      if (fallback) {
        customer = upsertCustomer({ document: doc, ...fallback });
      } else {
        showToast("CNPJ nao encontrado na consulta. Confira o numero.");
        return;
      }
    } finally {
      button.disabled = false;
      button.textContent = "Buscar";
    }
  }

  if (!customer) {
    if (doc && ![11, 14].includes(doc.length)) {
      showToast("CPF/CNPJ incompleto. Confira o numero digitado.");
      return;
    }
    if (doc.length === 11) {
      showToast("CPF nao possui consulta publica da Receita. Preencha o cliente manualmente.");
      return;
    }
    showToast("Cliente nao encontrado. Preencha os dados para salvar.");
    return;
  }

  fillCustomer(customer);
  saveState();
  showToast("Dados do cliente preenchidos.");
}

function applyLastPrice() {
  const documentInput = qs("#customer-document");
  const productInput = qs("#sale-product");
  const priceInput = qs('[name="price"]');
  if (!documentInput || !productInput || !priceInput) return;

  const customer = findCustomer(documentInput.value);
  const productId = productInput.value;
  const lastOrder = state.orders
    .filter((order) => order.customerDoc === cleanDocument(documentInput.value) && orderItems(order).some((item) => item.productId === productId))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
  const lastItem = lastOrder ? orderItems(lastOrder).find((item) => item.productId === productId) : null;
  const lastPrice = lastItem?.price || lastOrder?.price || customer?.lastPrices?.[productId];
  if (lastPrice) {
    priceInput.value = Number(lastPrice).toFixed(2);
  }

  const priceLabel = qs("#last-sale-price");
  const dateLabel = qs("#last-sale-date");
  if (priceLabel) priceLabel.textContent = lastPrice ? money.format(Number(lastPrice)) : "Sem historico";
  if (dateLabel) dateLabel.textContent = lastOrder?.date ? lastOrder.date.split("-").reverse().join("/") : "Sem historico";
  updateSaleTotalPreview();
}

function setSaleProductLocked(locked = false) {
  const productInput = qs("#sale-product");
  if (!productInput) return;
  productInput.disabled = Boolean(locked);
  productInput.title = locked
    ? "Produto bloqueado porque este pedido esta vinculado a nota fiscal."
    : "";
}


function saleCustomerHasDestination() {
  const documentValue = cleanDocument(qs("#customer-document")?.value || "");
  const customerName = String(qs("#customer-name")?.value || "").trim();
  // Para distribuicao de carga, o campo de busca pode ficar com texto antigo.
  // O destino deve ser considerado cliente somente quando CPF/CNPJ ou nome estiverem preenchidos.
  return Boolean(documentValue || customerName);
}

function directLoadStockDestination() {
  const hasDirectLoad = !qs("#direct-load-info")?.hidden;
  const distributionActive = Boolean(sourceEntryDistributionEnabled
    || currentDirectLoadEntries().some((entry) => entry.distributionStarted));
  if (!hasDirectLoad || !distributionActive) return "";
  if (saleCustomerHasDestination()) return "";
  const location = normalizeLocation(qs("#sale-stock-location")?.value || "Divinopolis");
  return stockLocations.includes(location) ? location : "Divinopolis";
}

function directLoadIsStockDestination() {
  return Boolean(directLoadStockDestination());
}

function currentDirectLoadEntries(entry = null) {
  const grouped = sourceEntryGroupForOrderIds
    .map((entryId) => state.stockEntries.find((item) => item.id === entryId))
    .filter(Boolean);
  if (grouped.length) return grouped;
  if (entry) return [entry];
  if (sourceEntryForOrderId) {
    const sourceEntry = state.stockEntries.find((item) => item.id === sourceEntryForOrderId);
    return sourceEntry ? [sourceEntry] : [];
  }
  return [];
}

function renderDirectLoadDistributionLedger(entries = []) {
  const container = qs("#direct-load-distribution-ledger");
  if (!container) return;
  const validEntries = entries.filter(Boolean);
  if (!validEntries.length) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const rows = [];
  validEntries.forEach((entry) => {
    entryAllocations(entry).forEach((allocation) => {
      if (allocation.type === "stock") {
        rows.push({
          product: entry.product,
          destination: `Estoque ${allocation.location || "-"}`,
          qty: allocation.qty
        });
        return;
      }
      const order = state.orders.find((item) => item.id === allocation.orderId);
      rows.push({
        product: entry.product,
        destination: `${allocation.orderId || "Pedido"} - ${order?.customer || allocation.customer || "Cliente"}`,
        qty: allocation.qty
      });
    });
  });
  const totalQty = validEntries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
  const allocatedQty = validEntries.reduce((sum, entry) => sum + entryAllocatedQuantity(entry), 0);
  const remainingQty = validEntries.reduce((sum, entry) => sum + entryRemainingQuantity(entry), 0);
  const productSummaryHtml = validEntries.map((entry) => `
    <div>
      <strong>${escapeHtml(entry.product || "-")}:</strong>
      total ${formatQty(entry.quantity)} |
      salvo ${formatQty(entryAllocatedQuantity(entry))} |
      saldo ${formatQty(entryRemainingQuantity(entry))}
    </div>
  `).join("");
  const rowsHtml = rows.length
    ? rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.product || "-")}</td>
          <td>${escapeHtml(row.destination || "-")}</td>
          <td class="right">${formatQty(row.qty)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="3">Nenhuma parte salva ainda.</td></tr>`;

  container.hidden = false;
  container.innerHTML = `
    <strong>Distribuicao da nota</strong>
    <div class="direct-load-distribution-summary">
      Total da nota: ${formatQty(totalQty)} |
      Salvo: ${formatQty(allocatedQty)} |
      Saldo restante: ${formatQty(remainingQty)}
      ${validEntries.length > 1 ? `<div class="direct-load-product-summary">${productSummaryHtml}</div>` : ""}
    </div>
    ${rows.length && remainingQty > 0.009 ? `
      <div class="direct-load-distribution-guidance">
        Parte salva. Informe o proximo cliente ou deixe o cliente em branco para enviar o saldo para Arcos/Divinopolis.
      </div>
    ` : ""}
    <table>
      <thead>
        <tr>
          <th>Produto</th>
          <th>Destino salvo</th>
          <th>Quantidade</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function setFieldRequired(selector, required) {
  const field = qs(selector);
  if (field) field.required = Boolean(required);
}

function setFieldLabelVisible(selector, visible) {
  const field = qs(selector);
  const label = field?.closest("label");
  if (label) label.hidden = !visible;
}

function updateDirectLoadDestinationMode() {
  const hasDirectLoad = !qs("#direct-load-info")?.hidden;
  const distributionActive = Boolean(sourceEntryDistributionEnabled
    || currentDirectLoadEntries().some((entry) => entry.distributionStarted));
  const stockLocation = hasDirectLoad && distributionActive ? directLoadStockDestination() : "";
  const isStock = Boolean(stockLocation);
  const customerSection = qs(".sale-customer-section");
  if (customerSection) customerSection.hidden = isStock && !distributionActive;
  setFieldLabelVisible('[name="price"]', !isStock);
  setFieldLabelVisible('[name="payment"]', !isStock);
  setFieldLabelVisible('[name="salesperson"]', !isStock);
  setFieldLabelVisible('[name="driver"]', !isStock);
  qs("#toggle-freight-return")?.toggleAttribute("hidden", isStock);
  qs(".last-sale-info")?.toggleAttribute("hidden", isStock);
  setFieldRequired('[name="document"]', !isStock);
  setFieldRequired('[name="customer"]', !isStock);
  setFieldRequired('[name="salesperson"]', !isStock);
  setFieldRequired('[name="price"]', !isStock);
  const priceInput = qs('[name="price"]');
  if (priceInput) {
    priceInput.disabled = isStock;
    if (isStock) priceInput.value = "0.00";
  }
  const paymentInput = qs('[name="payment"]');
  if (paymentInput) paymentInput.disabled = isStock;
  const salespersonInput = qs('[name="salesperson"]');
  if (salespersonInput) salespersonInput.disabled = isStock;
  const stockSelect = qs("#sale-stock-location");
  if (stockSelect) {
    if (hasDirectLoad && distributionActive) {
      stockSelect.disabled = !isStock;
      stockSelect.title = isStock
        ? "Selecione a unidade que recebera o saldo da carga."
        : "Unidade bloqueada porque esta parte esta destinada a cliente.";
    } else if (hasDirectLoad) {
      stockSelect.disabled = true;
      stockSelect.title = "Unidade bloqueada em carga direta sem distribuicao.";
    } else {
      stockSelect.disabled = false;
      stockSelect.title = "";
    }
    if (isStock) stockSelect.value = stockLocation;
  }
  const submit = qs("#sale-submit-btn");
  if (submit && hasDirectLoad && !editingOrderId) {
    submit.textContent = distributionActive ? "Salvar parte" : "Salvar pedido vinculado";
  }
}

function sendDirectLoadQuantityToStock(stockLocation, qty) {
  const sourceEntry = sourceEntryForOrderId
    ? state.stockEntries.find((entry) => entry.id === sourceEntryForOrderId)
    : null;
  const sourceEntryGroup = sourceEntryGroupForOrderIds
    .map((entryId) => state.stockEntries.find((entry) => entry.id === entryId))
    .filter(Boolean);
  const entries = sourceEntryGroup.length ? sourceEntryGroup : sourceEntry ? [sourceEntry] : [];
  if (!entries.length) {
    showToast("Nota vinculada nao encontrada.");
    return false;
  }
  if (entries.some((entry) => isStockDateLocked(entry.date))) {
    showToast(`Estoque travado ate ${formatDateBR(state.stockLockDate)}. Nao e possivel mandar esta carga ao estoque nessa data.`);
    return false;
  }
  const groupedRows = sourceEntryGroup.length > 1 ? directLoadGroupedRows() : [];
  const allocationItems = sourceEntryGroup.length > 1 ? groupedRows.filter((item) => item.qty > 0.009) : [];
  const totalAvailable = entries.reduce((sum, entry) => sum + entryRemainingQuantity(entry), 0);
  if (!qty || qty <= 0) {
    showToast("Informe uma quantidade maior que zero.");
    return false;
  }
  if (sourceEntryGroup.length > 1 && !allocationItems.length) {
    showToast("Informe a quantidade de pelo menos um produto da nota.");
    return false;
  }
  const invalidGroupedQty = groupedRows.find((item) => item.qty < 0 || item.qty > item.remaining + 0.009);
  if (invalidGroupedQty) {
    showToast(`Quantidade invalida para ${invalidGroupedQty.product}. Saldo disponivel: ${formatQty(invalidGroupedQty.remaining)}.`);
    return false;
  }
  if (!sourceEntryGroup.length && qty > totalAvailable + 0.009) {
    showToast(`Quantidade maior que o saldo disponivel da nota: ${formatQty(totalAvailable)}.`);
    return false;
  }
  const allocations = allocationItems.length
    ? allocationItems.map((item) => ({ entry: entries.find((entry) => entry.id === item.sourceEntryId), qty: item.qty }))
    : [{ entry: entries[0], qty: Math.min(qty, entryRemainingQuantity(entries[0])) }];

  for (const item of allocations) {
    if (!item.entry || item.qty <= 0) continue;
    if (item.qty > entryRemainingQuantity(item.entry) + 0.009) {
      showToast(`Quantidade maior que o saldo disponivel para ${item.entry.product}: ${formatQty(entryRemainingQuantity(item.entry))}.`);
      return false;
    }
  }

  allocations.forEach((item) => {
    if (!item.entry || item.qty <= 0.009) return;
    beginEntryDistribution(item.entry);
    const allocationId = `ALOC-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    let product = findStockProductForEntry(item.entry) || findStockProductByName(item.entry.product);
    if (!product) product = ensureStockProduct(item.entry.product, item.entry.supplier || item.entry.brand || "Fornecedor importado", item.entry.invoice);
    changeProductLocationQty(product, stockLocation, item.qty);
    entryAllocations(item.entry).push({
      id: allocationId,
      type: "stock",
      location: stockLocation,
      qty: item.qty,
      sourceEntryId: item.entry.id,
      sourceInvoice: item.entry.invoice || "",
      sourceFactoryOrder: item.entry.factoryOrder || "",
      product: item.entry.product || "",
      supplier: item.entry.supplier || "",
      createdAt: new Date().toISOString()
    });
    state.movements.unshift({
      date: today,
      op: `Distribuicao NF ${item.entry.invoice} para estoque ${stockLocation}`,
      product: item.entry.product,
      qty: item.qty,
      sourceEntryId: item.entry.id,
      sourceInvoice: item.entry.invoice || "",
      sourceFactoryOrder: item.entry.factoryOrder || "",
      allocationId
    });
    updateInvoiceDistributionStatus(item.entry);
  });

  const remainingIds = entries.filter((entry) => entryRemainingQuantity(entry) > 0.009).map((entry) => entry.id);
  resetSaleForm();
  saveState();
  renderAll();
  if (remainingIds.length > 1) {
    createDirectOrderFromEntryGroup(remainingIds.join(","));
    showToast(`Quantidade enviada para ${stockLocation}. Continue distribuindo o saldo restante.`);
  } else if (remainingIds.length === 1) {
    createDirectOrderFromEntry(remainingIds[0]);
    showToast(`Quantidade enviada para ${stockLocation}. Continue distribuindo o saldo restante.`);
  } else {
    showToast(`Quantidade enviada para o estoque de ${stockLocation}. Distribuicao concluida.`);
  }
  return true;
}

function showDirectLoadInfo(invoice = "", factoryOrder = "", entry = null) {
  const panel = qs("#direct-load-info");
  if (!panel) return;
  const hasDirectLoad = Boolean(invoice || factoryOrder);
  panel.hidden = !hasDirectLoad;
  setSaleProductLocked(hasDirectLoad);
  qs("#direct-load-invoice").value = invoice || "Nao informado";
  qs("#direct-load-factory-order").value = factoryOrder || "Nao informado";
  const distributionButton = qs("#enable-load-distribution");
  const distributionStatus = qs("#direct-load-distribution-status");
  const directEntries = currentDirectLoadEntries(entry);
  const distributionActive = Boolean(sourceEntryDistributionEnabled
    || directEntries.some((item) => item.distributionStarted));
  const totalRemaining = directEntries.reduce((sum, item) => sum + entryRemainingQuantity(item), 0);
  if (distributionButton) {
    distributionButton.hidden = !hasDirectLoad;
    distributionButton.disabled = distributionActive;
    distributionButton.textContent = distributionActive ? "Distribuicao ativada" : "Distribuir carga";
  }
  if (distributionStatus) {
    distributionStatus.textContent = distributionActive
      ? `Distribuicao ativa. Informe cliente, quantidade e valor; ou deixe cliente em branco e selecione Arcos/Divinopolis para mandar ao estoque. Saldo disponivel: ${formatQty(totalRemaining)}.`
      : "O pedido utilizara todo o saldo restante da nota.";
  }
  renderDirectLoadDistributionLedger(hasDirectLoad ? directEntries : []);
  updateDirectLoadDestinationMode();
}

function renderDirectLoadItems(entries = []) {
  const panel = qs("#direct-load-items-panel");
  const table = qs("#direct-load-items-table");
  if (!panel || !table) return;
  const items = entries.filter((entry) => entry && entryRemainingQuantity(entry) > 0.009);
  panel.hidden = items.length <= 1;
  if (items.length <= 1) {
    table.innerHTML = "";
    return;
  }
  table.innerHTML = items.map((entry) => {
    const qty = entryRemainingQuantity(entry);
    const distributionActive = Boolean(sourceEntryDistributionEnabled
      || items.some((item) => item.distributionStarted));
    const defaultQty = distributionActive ? 0 : qty;
    return `
      <tr>
        <td>${escapeHtml(entry.product)}</td>
        <td>
          <input class="direct-load-item-qty" type="number" min="0" max="${qty}" step="1" value="${defaultQty}" data-direct-item-qty-input="${escapeAttr(entry.id)}" />
        </td>
        <td>
          <input class="direct-load-item-price" type="number" min="0.01" step="0.01" value="0.00" data-direct-item-price="${escapeAttr(entry.id)}" />
        </td>
        <td class="right" data-direct-item-total="${escapeAttr(entry.id)}">R$ 0,00</td>
      </tr>
    `;
  }).join("");
}

function directLoadGroupedRows() {
  return sourceEntryGroupForOrderIds
    .map((entryId) => state.stockEntries.find((entry) => entry.id === entryId))
    .filter((entry) => entry && entryRemainingQuantity(entry) > 0.009)
    .map((entry) => {
      const remaining = entryRemainingQuantity(entry);
      const qtyInput = qs(`[data-direct-item-qty-input="${CSS.escape(entry.id)}"]`);
      const input = qs(`[data-direct-item-price="${CSS.escape(entry.id)}"]`);
      const qty = Number(qtyInput?.value || 0);
      const price = Number(input?.value || 0);
      const product = findStockProductForEntry(entry);
      return {
        sourceEntryId: entry.id,
        productId: product?.id || "",
        product: entry.product,
        qty,
        remaining,
        price,
        value: qty * price
      };
    });
}

function directLoadGroupedItems() {
  return directLoadGroupedRows()
    .filter((item) => item.qty > 0.009);
}

function updateDirectLoadItemTotals() {
  const items = directLoadGroupedItems();
  items.forEach((item) => {
    const cell = qs(`[data-direct-item-total="${CSS.escape(item.sourceEntryId)}"]`);
    if (cell) cell.textContent = money.format(item.value || 0);
  });
  if (items.length) {
    const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
    const totalValue = items.reduce((sum, item) => sum + item.value, 0);
    const quantityInput = qs('[name="quantity"]');
    const priceInput = qs('[name="price"]');
    if (quantityInput) quantityInput.value = totalQty;
    if (priceInput && totalQty > 0) priceInput.value = (totalValue / totalQty).toFixed(2);
  }
}

function setSaleFreightType(type = "entrega") {
  const isReturn = type === "retorno";
  const input = qs("#sale-freight-type");
  const button = qs("#toggle-freight-return");
  if (input) input.value = isReturn ? "retorno" : "entrega";
  if (button) {
    button.classList.toggle("active", isReturn);
    button.setAttribute("aria-pressed", String(isReturn));
    button.textContent = isReturn ? "Frete de retorno marcado" : "Marcar frete de retorno";
  }
}

function resetSaleForm() {
  editingOrderId = "";
  sourceEntryForOrderId = "";
  sourceEntryDistributionEnabled = false;
  sourceEntryGroupForOrderIds = [];
  qs("#sale-form").reset();
  qs("#customer-search").value = "";
  setSaleProductLocked(false);
  qs('[name="price"]').value = "38.90";
  qs('[name="quantity"]').removeAttribute("max");
  qs("#sale-stock-location").disabled = false;
  qs('[name="driver"]').value = "";
  qs('[name="salesperson"]').value = state.salespeople[0] || "";
  qs('[name="salesperson"]').disabled = false;
  qs('[name="payment"]').disabled = false;
  qs('[name="payment"]').dataset.term = "";
  qs('[name="payment"]').dataset.rule = "";
  qs("#sale-payment-term").value = "";
  qs("#sale-payment-term").readOnly = false;
  qs("#sale-payment-rule-status").textContent = "";
  qs("#sale-form-title").textContent = "Novo pedido de venda";
  qs("#sale-edit-tag").textContent = "Novo";
  qs("#sale-submit-btn").textContent = "Salvar pedido";
  qs("#last-sale-price").textContent = "Sem historico";
  qs("#last-sale-date").textContent = "Sem historico";
  qs("#sale-stock-location").value = "Divinopolis";
  setSaleFreightType("entrega");
  setSaleExtraItems([]);
  setSaleExtraItemsVisible(true);
  showDirectLoadInfo();
  renderDirectLoadItems();
  updateDirectLoadDestinationMode();
  updateSaleTotalPreview();
}

function startEditOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  editingOrderId = orderId;
  sourceEntryForOrderId = "";
  sourceEntryDistributionEnabled = false;
  sourceEntryGroupForOrderIds = [];

  qs("#customer-search").value = `${order.customer} - ${formatDocument(order.customerDoc)}`;
  qs("#customer-document").value = formatDocument(order.customerDoc);
  qs("#customer-name").value = order.customer;
  qs("#customer-address").value = order.address || "";
  qs("#customer-phone").value = order.phone || "";
  qs("#sale-product").value = order.productId;
  setSaleProductLocked(Boolean(order.directLoad || order.sourceEntryId));
  qs("#sale-stock-location").disabled = Boolean(order.directLoad || order.sourceEntryId);
  qs("#sale-stock-location").value = stockLocations.includes(order.stockLocation) ? order.stockLocation : "Divinopolis";
  qs('[name="salesperson"]').value = order.salesperson || "Edmilson";
  qs('[name="salesperson"]').disabled = false;
  qs('[name="driver"]').value = cleanDriverName(order.driver) || "";
  setSaleFreightType(order.freightType || "entrega");
  qs('[name="quantity"]').value = order.qty;
  qs('[name="price"]').value = Number(order.price || order.value / order.qty).toFixed(2);
  const editableItems = !order.directLoad ? orderItems(order) : [];
  if (editableItems.length > 1) {
    const firstItem = editableItems[0];
    qs("#sale-product").value = firstItem.productId || order.productId;
    qs('[name="quantity"]').value = firstItem.qty;
    qs('[name="price"]').value = Number(firstItem.price || 0).toFixed(2);
    setSaleExtraItems(editableItems.slice(1));
  } else {
    setSaleExtraItems([]);
  }
  setSaleExtraItemsVisible(!order.directLoad && !order.sourceEntryId);
  qs('[name="payment"]').value = order.payment || "Boleto";
  qs('[name="payment"]').disabled = false;
  qs('[name="payment"]').dataset.term = order.paymentTerm || "";
  qs("#sale-payment-term").value = order.paymentTerm || "";
  qs("#sale-payment-term").readOnly = false;
  qs('[name="observation"]').value = order.observation || "";
  updateSaleTotalPreview();
  const sourceEntry = state.stockEntries.find((entry) => entry.id === order.sourceEntryId)
    || state.stockEntries.find((entry) => entry.invoice === order.sourceInvoice);
  sourceEntryDistributionEnabled = Boolean(sourceEntry?.distributionStarted);
  showDirectLoadInfo(
    order.sourceInvoice || sourceEntry?.invoice || "",
    order.sourceFactoryOrder || sourceEntry?.factoryOrder || "",
    sourceEntry || null
  );
  qs("#sale-form-title").textContent = `Editar pedido ${order.id}`;
  qs("#sale-edit-tag").textContent = "Editando";
  qs("#sale-submit-btn").textContent = "Salvar alterações";
  qs('[data-view="pedidos"]').click();
  qs("#sale-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleSale(event) {
  event.preventDefault();
  refreshToday();
  const loggedUser = getLoggedUser();
  if (!loggedUser) {
    showLogin();
    showToast("Faca login para emitir o pedido.");
    return;
  }
  const data = new FormData(event.currentTarget);
  let product = state.stock.find((item) => item.id === data.get("product"));
  let qty = Number(data.get("quantity"));
  const price = Number(data.get("price"));
  const directStockLocation = directLoadStockDestination();
  const documentValue = cleanDocument(data.get("document"));
  const editingOrder = editingOrderId ? state.orders.find((item) => item.id === editingOrderId) : null;
  const sourceEntryGroup = sourceEntryGroupForOrderIds
    .map((entryId) => state.stockEntries.find((entry) => entry.id === entryId))
    .filter(Boolean);
  const sourceEntry = sourceEntryForOrderId
    ? state.stockEntries.find((entry) => entry.id === sourceEntryForOrderId)
    : editingOrder?.sourceEntryId
      ? state.stockEntries.find((entry) => entry.id === editingOrder.sourceEntryId)
      : null;
  const sourceEntryProduct = findStockProductForEntry(sourceEntry);
  if (sourceEntryProduct) product = sourceEntryProduct;
  const isDirectLoad = Boolean(sourceEntry || editingOrder?.directLoad);
  const stockLocation = isDirectLoad ? "" : normalizeLocation(data.get("stockLocation"));
  const stockQtyBeforeOrder = isDirectLoad ? null : productAvailableQty(product, stockLocation);
  const observation = String(data.get("observation") || "").trim();
  const driver = cleanDriverName(data.get("driver"));
  const freightType = data.get("freightType") === "retorno" ? "retorno" : "entrega";
  const paymentInput = qs('[name="payment"]');

  if (!product) {
    showToast("Produto nao encontrado.");
    return;
  }
  if (!qty || qty <= 0) {
    showToast("Informe uma quantidade maior que zero.");
    return;
  }
  const isGroupedDirectMode = sourceEntryGroup.length > 1 && !editingOrderId;
  const groupedDirectRows = isGroupedDirectMode ? directLoadGroupedRows() : [];
  const groupedDirectItems = isGroupedDirectMode ? groupedDirectRows.filter((item) => item.qty > 0.009) : [];
  if (isGroupedDirectMode && !groupedDirectItems.length) {
    showToast("Informe a quantidade de pelo menos um produto da nota.");
    return;
  }
  if (isGroupedDirectMode) {
    const invalidGroupedQty = groupedDirectRows.find((item) => item.qty < 0 || item.qty > item.remaining + 0.009);
    if (invalidGroupedQty) {
      showToast(`Quantidade invalida para ${invalidGroupedQty.product}. Saldo disponivel: ${formatQty(invalidGroupedQty.remaining)}.`);
      return;
    }
    const distributionActive = Boolean(sourceEntryDistributionEnabled || sourceEntryGroup.some((entry) => entry.distributionStarted));
    const partialWithoutDistribution = !distributionActive
      && groupedDirectRows.some((item) => Math.abs(Number(item.qty || 0) - Number(item.remaining || 0)) > 0.009);
    if (partialWithoutDistribution) {
      showToast("Para usar apenas parte da nota, clique em Distribuir carga. Sem distribuicao, todos os produtos devem fechar o saldo total da NF.");
      return;
    }
  }
  if (isGroupedDirectMode) {
    qty = groupedDirectItems.reduce((sum, item) => sum + item.qty, 0);
  }
  if (isGroupedDirectMode && !directStockLocation && groupedDirectItems.some((item) => !item.price || item.price <= 0)) {
    showToast("Informe o preco unitario dos produtos que serao salvos nesta parte.");
    return;
  }
  const standardOrderItems = !isDirectLoad ? buildStandardOrderItems(product, qty, price, stockLocation) : [];
  if (standardOrderItems.length) {
    if (standardOrderItems.some((item) => !item.productId || !item.qty || item.qty <= 0 || !item.price || item.price <= 0)) {
      showToast("Informe produto, quantidade e preco unitario de todos os itens.");
      return;
    }
  }
  const currentDirectAllocation = sourceEntry && editingOrderId
    ? entryAllocations(sourceEntry).find((allocation) => allocation.orderId === editingOrderId)
    : null;
  const directAvailable = sourceEntryGroup.length
    ? sourceEntryGroup.reduce((sum, entry) => sum + entryRemainingQuantity(entry), 0)
    : sourceEntry
    ? entryRemainingQuantity(sourceEntry) + Number(currentDirectAllocation?.qty || 0)
    : 0;
  if (isDirectLoad && sourceEntry && qty > directAvailable + 0.009) {
    showToast(`Quantidade maior que o saldo disponivel da nota: ${formatQty(directAvailable)}.`);
    return;
  }
  if (isDirectLoad && directStockLocation && !editingOrderId) {
    sendDirectLoadQuantityToStock(directStockLocation, qty);
    return;
  }
  if (isDirectLoad && sourceEntry && !sourceEntryDistributionEnabled
    && !sourceEntry.distributionStarted && Math.abs(qty - directAvailable) > 0.009) {
    showToast("Para usar apenas parte da quantidade, clique em Distribuir carga dentro do pedido.");
    return;
  }
  if (!isDirectLoad) {
    const currentOrder = editingOrderId ? state.orders.find((item) => item.id === editingOrderId) : null;
    const currentOrderQty = currentOrder
      && currentOrder.stockPosted
      && !currentOrder.directLoad
      && currentOrder.productId === product.id
      && normalizeLocation(currentOrder.stockLocation) === stockLocation
      ? Number(currentOrder.qty || 0)
      : 0;
    const availableQty = productAvailableQty(product, stockLocation) + currentOrderQty;
    if (availableQty <= 0 || qty > availableQty) {
      showToast(`Estoque insuficiente em ${stockLocation}. Saldo disponivel: ${formatQty(availableQty)}.`);
      return;
    }
  }

  if (!isDirectLoad && standardOrderItems.length > 1) {
    for (const item of standardOrderItems.slice(1)) {
      const itemProduct = state.stock.find((stockItem) => stockItem.id === item.productId);
      const availableQty = productAvailableQty(itemProduct, stockLocation);
      if (availableQty <= 0 || item.qty > availableQty) {
        showToast(`Estoque insuficiente em ${stockLocation}. Saldo disponivel para ${item.product || "produto"}: ${formatQty(availableQty)}.`);
        return;
      }
    }
    qty = standardOrderItems.reduce((sum, item) => sum + item.qty, 0);
  }

  if (!directStockLocation && (!documentValue || !String(data.get("customer") || "").trim())) {
    showToast("Informe o cliente ou deixe CPF/CNPJ e cliente em branco para enviar para Arcos/Divinopolis.");
    return;
  }

  const customer = upsertCustomer({
    document: documentValue,
    name: data.get("customer"),
    address: data.get("address"),
    phone: data.get("phone")
  });
  if (groupedDirectItems.length) {
    groupedDirectItems.forEach((item) => {
      const itemProduct = findStockProductByName(item.product);
      if (itemProduct) customer.lastPrices[itemProduct.id] = item.price;
    });
  } else if (standardOrderItems.length) {
    standardOrderItems.forEach((item) => {
      customer.lastPrices[item.productId] = item.price;
    });
  } else {
    customer.lastPrices[product.id] = price;
  }
  const orderSalesperson = applySaleSalesperson(customer) || linkedCustomerSalesperson(customer) || state.salespeople[0] || "";
  const salespersonField = qs('[name="salesperson"]');
  if (salespersonField && orderSalesperson) {
    salespersonField.value = orderSalesperson;
    delete salespersonField.dataset.lockedValue;
    salespersonField.disabled = false;
  }
  const paymentRule = resolvePaymentRule(customer, orderSalesperson);
  const paymentTermInput = qs("#sale-payment-term");
  const selectedPayment = paymentInput?.value || data.get("payment") || "";
  const typedPaymentTerm = String(paymentTermInput?.value || data.get("paymentTerm") || "").trim();
  const orderPayment = selectedPayment || paymentRule?.payment || state.paymentMethods[0] || "Boleto";
  const orderPaymentTerm = typedPaymentTerm || paymentInput?.dataset.term || paymentRule?.term || "";
  if (paymentTermInput) paymentTermInput.value = orderPaymentTerm || "";

  const value = groupedDirectItems.length
    ? groupedDirectItems.reduce((sum, item) => sum + item.value, 0)
    : standardOrderItems.length
      ? standardOrderItems.reduce((sum, item) => sum + item.value, 0)
      : qty * price;
  const orderUnitPrice = (groupedDirectItems.length || standardOrderItems.length) && qty ? value / qty : price;
  const isGroupedDirectOrder = Boolean(sourceEntry && sourceEntryGroup.length > 1 && !editingOrderId);
  const groupedProductsLabel = isGroupedDirectOrder
    ? groupedDirectItems.map((item) => `${item.product} ${formatQty(item.qty)} ${money.format(item.price)}`).join(" / ")
    : "";
  const groupedOrderItems = groupedDirectItems.map((item) => ({
    productId: item.productId || "",
    product: item.product || "",
    qty: Number(item.qty || 0),
    price: Number(item.price || 0),
    value: Number(item.value || 0),
    stockLocation
  }));
  const standardProductsLabel = standardOrderItems.length > 1
    ? standardOrderItems.map((item) => `${item.product} ${formatQty(item.qty)}`).join(" / ")
    : "";

  if (editingOrderId) {
    const order = editingOrder;
    if (!order) {
      resetSaleForm();
      showToast("Pedido nao encontrado para edicao.");
      return;
    }

    const editingDirectLoad = Boolean(order.directLoad || order.sourceEntryId);
    const originalDirectItems = editingDirectLoad ? orderItems(order) : [];
    const originalDirectProductId = order.productId;
    const originalDirectProduct = order.product;
    const originalDirectLoadItems = Array.isArray(order.directLoadItems)
      ? order.directLoadItems.map((item) => ({ ...item }))
      : [];

    const wasDelivered = order.stockPosted;
    if (wasDelivered && !order.directLoad) changeOrderItemsStock(order, 1, "Estorno de ajuste de pedido");

    if (wasDelivered) {
      if (!order.directLoad) {
        const stockCheck = hasStockForOrderItems(standardOrderItems, stockLocation);
        if (!stockCheck.ok) {
          changeOrderItemsStock(order, -1, "Reaplicacao de pedido");
          showToast(`Estoque insuficiente para salvar pedido entregue. Saldo de ${stockCheck.product}: ${formatQty(stockCheck.availableQty)}.`);
          return;
        }
      }
      if (!order.directLoad) {
        const updatedStockOrder = { ...order, items: standardOrderItems, stockLocation };
        changeOrderItemsStock(updatedStockOrder, -1, "Ajuste de pedido");
      }
    }

    order.customerDoc = customer.document;
    order.customer = customer.name;
    order.address = customer.address;
    order.phone = customer.phone;
    if (editingDirectLoad) {
      const directValue = qty * price;
      order.productId = originalDirectProductId || product.id;
      order.product = originalDirectProduct || product.product;
      order.qty = qty;
      order.price = price;
      order.value = directValue;
      if (originalDirectItems.length === 1) {
        order.items = [{
          ...originalDirectItems[0],
          qty,
          price,
          value: directValue
        }];
      } else if (originalDirectItems.length > 1) {
        order.items = order.items || [];
      } else {
        order.items = [];
      }
      order.directLoadItems = originalDirectLoadItems;
    } else {
      order.productId = product.id;
      order.product = standardProductsLabel || product.product;
      order.qty = qty;
      order.price = orderUnitPrice;
      order.value = value;
      order.items = standardOrderItems;
    }
    order.payment = orderPayment;
    order.paymentTerm = orderPaymentTerm;
    order.salesperson = orderSalesperson;
    order.driver = driver;
    order.freightType = freightType;
    order.observation = observation;
    order.stockLocation = editingDirectLoad ? order.stockLocation : stockLocation;

    if (order.directLoad && sourceEntry) {
      const allocation = entryAllocations(sourceEntry).find((item) => item.orderId === order.id);
      if (allocation) allocation.qty = qty;
      updateInvoiceDistributionStatus(sourceEntry);
    }

    const receivable = state.receivables.find((item) => item.origin === order.id);
    if (receivable) {
      receivable.customer = customer.name;
      receivable.value = order.value;
      receivable.payment = order.payment;
    }
    replaceOpenReceivablesForOrder(order);

    resetSaleForm();
    saveState();
    renderAll();
    showToast("Pedido atualizado.");
    return;
  }

  const id = nextOrderId(sourceEntry ? "PVN" : "PV");
  state.reusableOrderIds = (state.reusableOrderIds || []).filter((reusableId) => reusableId !== id);
  const order = {
    id,
    customerDoc: customer.document,
    customer: customer.name,
    address: customer.address,
    phone: customer.phone,
    productId: product.id,
    product: groupedProductsLabel || standardProductsLabel || product.product,
    qty,
    price: orderUnitPrice,
    value,
    date: today,
    payment: orderPayment,
    paymentTerm: orderPaymentTerm,
    salesperson: orderSalesperson,
    freightType,
    observation,
    status: "Aberto",
    deliveryStatus: isDirectLoad ? "Entregue" : "Pedido",
    stockPosted: isDirectLoad,
    driver: driver || (sourceEntry ? cleanDriverName(sourceEntry.loadedBy) : ""),
    deliveryForecast: sourceEntry?.date || "",
    deliveryNote: sourceEntry ? `Pedido vinculado a NF-e ${sourceEntry.invoice}. Pedido fabrica ${sourceEntry.factoryOrder || "-"}.` : "",
    stockLocation,
    directLoad: isDirectLoad,
    sourceEntryId: sourceEntry?.id || "",
    sourceEntryIds: sourceEntryGroup.length ? sourceEntryGroup.map((entry) => entry.id) : [],
    directLoadItems: groupedDirectItems,
    items: isGroupedDirectOrder ? groupedOrderItems : standardOrderItems,
    sourceInvoice: sourceEntry?.invoice || "",
    sourceFactoryOrder: sourceEntry?.factoryOrder || "",
    issuedAt: new Date().toISOString(),
    sellerUser: loggedUser.user,
    sellerName: loggedUser.name,
    sellerRole: loggedUser.role
  };
  state.orders.unshift(order);
  if (!isDirectLoad) {
    product.locations = product.locations || makeEmptyLocations();
    product.locations[stockLocation] = stockQtyBeforeOrder;
    syncProductTotal(product);
    order.stockPosted = false;
    order.deliveryStatus = "Pedido";
  }
  if (sourceEntry) {
    const allocationEntries = sourceEntryGroup.length ? sourceEntryGroup : [sourceEntry];
    const groupedItemByEntryId = new Map(groupedDirectItems.map((item) => [item.sourceEntryId, item]));
    allocationEntries.forEach((entry) => {
      const allocationQty = groupedItemByEntryId.has(entry.id)
        ? Number(groupedItemByEntryId.get(entry.id).qty || 0)
        : sourceEntryGroup.length
          ? entryRemainingQuantity(entry)
          : Math.min(qty, entryRemainingQuantity(entry));
      if (allocationQty <= 0.009) return;
      beginEntryDistribution(entry);
      entryAllocations(entry).push({
        id: `ALOC-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        type: "order",
        orderId: id,
        qty: allocationQty,
        customer: order.customer,
        customerDoc: order.customerDoc,
        sourceEntryId: entry.id,
        sourceInvoice: entry.invoice || "",
        sourceFactoryOrder: entry.factoryOrder || "",
        product: entry.product || "",
        createdAt: new Date().toISOString()
      });
      entry.generatedOrderId = entry.generatedOrderId || id;
      entry.linkedOrderId = entry.linkedOrderId || id;
      state.notes.forEach((note) => {
        if (note.number === entry.invoice && normalizeSearch(note.supplier) === normalizeSearch(entry.supplier)) {
          note.linkedOrderIds = Array.isArray(note.linkedOrderIds) ? note.linkedOrderIds : [];
          if (!note.linkedOrderIds.includes(id)) note.linkedOrderIds.push(id);
          note.linkedOrderId = note.linkedOrderId || id;
        }
      });
      updateInvoiceDistributionStatus(entry);
    });
  }
  state.receivables.unshift(...buildReceivablesForOrder(order));
  const remainingGroupEntryIds = sourceEntryGroup.length
    ? sourceEntryGroup.filter((entry) => entryRemainingQuantity(entry) > 0.009).map((entry) => entry.id)
    : [];
  const directEntryId = sourceEntryGroup.length ? "" : sourceEntry?.id || "";
  const directRemaining = sourceEntryGroup.length ? 0 : sourceEntry ? entryRemainingQuantity(sourceEntry) : 0;
  const hasPendingDirectDistribution = Boolean((sourceEntryGroup.length && remainingGroupEntryIds.length) || directRemaining > 0.009);
  if (isDirectLoad) {
    order.distributionPending = hasPendingDirectDistribution;
    order.distributionComplete = !hasPendingDirectDistribution;
  }
  resetSaleForm();
  saveState();
  renderCustomerOptions();
  renderAll();
  if (directEntryId && directRemaining > 0.009) {
    createDirectOrderFromEntry(directEntryId);
    showToast(`Parte salva. Ainda falta distribuir ${formatQty(directRemaining)} desta nota.`);
    return;
  }
  if (remainingGroupEntryIds.length) {
    createDirectOrderFromEntryGroup(remainingGroupEntryIds.join(","));
    showToast("Parte salva. A nota ainda tem produto com saldo para distribuir.");
    return;
  }
  showToast(isDirectLoad ? "Distribuicao concluida. Pedido salvo." : "Pedido salvo. Estoque sera baixado somente na entrega.");
}

function updateOrderStage(orderId, nextStage) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  if (["Em carregamento", "Saiu para entrega"].includes(nextStage)) {
    nextStage = "Pedido";
  }

  let stockReversed = false;

  if (order.stockPosted && nextStage !== "Entregue" && !order.directLoad) {
    if (!assertStockDateUnlocked(orderStockDate(order), "estornar a baixa deste pedido")) return;
    changeOrderItemsStock(order, 1, "Estorno de entrega");
    order.stockPosted = false;
    stockReversed = true;
  }

  if (["Pedido", "Nao entregue"].includes(nextStage)) {
    order.deliveryStatus = nextStage;
    saveState();
    renderAll();
    showToast(stockReversed ? "Baixa estornada e quantidade devolvida ao estoque." : `Pedido marcado como ${nextStage}.`);
    return;
  }

  if (nextStage === "Entregue") {
    if (!order.stockPosted && !order.directLoad) {
      if (!assertStockDateUnlocked(orderStockDate(order), "baixar este pedido")) return;
      const location = normalizeLocation(order.stockLocation);
      const stockCheck = hasStockForOrderItems(orderItems(order), location);
      if (!stockCheck.ok) {
        showToast(`Estoque insuficiente para concluir a entrega. Saldo de ${stockCheck.product}: ${formatQty(stockCheck.availableQty)}.`);
        return;
      }
      changeOrderItemsStock(order, -1, "Entrega");
      order.stockPosted = true;
    }
    if (order.directLoad) order.stockPosted = true;
    order.deliveryStatus = "Entregue";
    saveState();
    renderAll();
    showToast(order.directLoad ? "Pedido de carga direta marcado como entregue." : "Pedido entregue e estoque baixado.");
    return;
  }

}

function updateOrderFinance(orderId, nextStatus) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  const receivables = state.receivables.filter((item) => item.origin === orderId);
  if (nextStatus === "Recebido") {
    receivables.forEach((receivable) => {
      if (receivable.status !== "Recebido") {
        receivable.accountId = receivable.accountId || state.financialAccounts[0]?.id || "";
        receiveReceivableValue(receivable, receivableBalance(receivable));
      }
    });
  } else {
    receivables.forEach((receivable) => {
      if (receivable.status !== "Recebido") receivable.status = Number(receivable.paidValue || 0) > 0 ? "Parcial" : "Aberto";
    });
  }
  order.status = nextStatus;
  saveState();
  renderAll();
  showToast("Status financeiro alterado.");
}

function receiveAccount(receivable, amount = receivable.value) {
  receivable.accountId = receivable.accountId || state.financialAccounts[0]?.id || "";
  if (!receivable.accountId) return false;
  const account = state.financialAccounts.find((item) => item.id === receivable.accountId);
  if (!account) return false;
  account.balance = Number(account.balance || 0) + Number(amount || 0);
  return true;
}

function cancelReceivablePayment(receivableId) {
  const receivable = state.receivables.find((item) => item.id === receivableId);
  if (!receivable || Number(receivable.paidValue || 0) <= 0) return;
  const paidValue = Number(receivable.paidValue || 0);
  if (receivable.accountId) {
    const account = state.financialAccounts.find((item) => item.id === receivable.accountId);
    if (account) account.balance = Number(account.balance || 0) - paidValue;
  }
  receivable.paidValue = 0;
  receivable.paymentDate = "";
  receivable.status = "Aberto";
  const order = state.orders.find((item) => item.id === receivable.origin);
  if (order) order.status = "Aberto";
  saveState();
  renderAll();
  showToast("Recebimento cancelado.");
}

function receiveReceivableValue(receivable, amount, paymentDate = today) {
  const balance = receivableBalance(receivable);
  const payAmount = Math.min(balance, Number(amount || 0));
  if (payAmount <= 0) return false;
  if (!receiveAccount(receivable, payAmount)) return false;
  receivable.paidValue = Number(receivable.paidValue || 0) + payAmount;
  receivable.paymentDate = paymentDate || today;
  receivable.status = receivableBalance(receivable) <= 0.009 ? "Recebido" : "Parcial";
  return true;
}

function updateReceivableField(receivableId, field, value) {
  const receivable = state.receivables.find((item) => item.id === receivableId);
  if (!receivable || (receivable.status === "Recebido" && field !== "billingStatus")) return;
  receivable[field] = value;
  const order = state.orders.find((item) => item.id === receivable.origin);
  if (order && field === "payment") order.payment = value;
  saveState();
  renderAll();
}

function payReceivable(receivableId, requestedAmount = 0, paymentDate = today) {
  const receivable = state.receivables.find((item) => item.id === receivableId);
  if (!receivable || receivable.status === "Recebido") return;
  receivable.accountId = receivable.accountId || state.financialAccounts[0]?.id || "";
  const balance = receivableBalance(receivable);
  const amount = requestedAmount > 0 ? requestedAmount : balance;
  if (amount > balance + 0.009) {
    showToast("Valor da baixa maior que o saldo em aberto.");
    return;
  }
  if (!receiveReceivableValue(receivable, amount, paymentDate)) {
    showToast("Conta financeira nao encontrada.");
    return;
  }
  const order = state.orders.find((item) => item.id === receivable.origin);
  if (order) {
    const openReceivables = state.receivables.some((item) => item.origin === order.id && item.status !== "Recebido");
    order.status = openReceivables ? "Aberto" : "Recebido";
  }
  saveState();
  renderAll();
  showToast(receivable.status === "Recebido" ? "Conta baixada no financeiro." : "Baixa parcial registrada.");
}

function addPaymentMethod(name) {
  const cleanName = name.trim();
  if (!cleanName) return;
  if (state.paymentMethods.some((method) => normalizeSearch(method) === normalizeSearch(cleanName))) {
    showToast("Forma de pagamento ja cadastrada.");
    return;
  }
  state.paymentMethods.push(cleanName);
  saveState();
  renderAll();
  showToast("Forma de pagamento adicionada.");
}

function savePaymentMethod(oldName, newName) {
  const cleanName = newName.trim();
  const index = state.paymentMethods.indexOf(oldName);
  if (index < 0 || !cleanName) return;
  state.paymentMethods[index] = cleanName;
  state.orders.forEach((order) => {
    if (order.payment === oldName) order.payment = cleanName;
  });
  state.receivables.forEach((receivable) => {
    if (receivable.payment === oldName) receivable.payment = cleanName;
  });
  state.paymentRules.forEach((rule) => {
    if (rule.payment === oldName) rule.payment = cleanName;
  });
  state.customers.forEach((customer) => {
    if (customer.payment === oldName) customer.payment = cleanName;
  });
  saveState();
  renderAll();
  showToast("Forma de pagamento salva.");
}

function deletePaymentMethod(name) {
  if (state.paymentMethods.length <= 1) {
    showToast("Mantenha pelo menos uma forma de pagamento.");
    return;
  }
  state.paymentMethods = state.paymentMethods.filter((method) => method !== name);
  const fallback = state.paymentMethods[0] || "";
  state.orders.forEach((order) => {
    if (order.payment === name) order.payment = fallback;
  });
  state.receivables.forEach((receivable) => {
    if (receivable.payment === name) receivable.payment = fallback;
  });
  state.paymentRules.forEach((rule) => {
    if (rule.payment === name) rule.payment = fallback;
  });
  state.customers.forEach((customer) => {
    if (customer.payment === name) customer.payment = fallback;
  });
  saveState();
  renderAll();
  showToast("Forma de pagamento excluida.");
}

function addPaymentTerm(term) {
  const cleanTerm = plainCustomerText(term);
  if (!cleanTerm) return;
  if (state.paymentTerms.some((item) => normalizeSearch(item) === normalizeSearch(cleanTerm))) {
    showToast("Prazo ja cadastrado.");
    return;
  }
  state.paymentTerms.push(cleanTerm);
  saveState();
  renderAll();
  showToast("Prazo adicionado.");
}

function savePaymentTerm(oldTerm, newTerm) {
  const cleanTerm = plainCustomerText(newTerm);
  const index = state.paymentTerms.indexOf(oldTerm);
  if (index < 0 || !cleanTerm) return;
  const duplicate = state.paymentTerms.some((term) => term !== oldTerm && normalizeSearch(term) === normalizeSearch(cleanTerm));
  if (duplicate) {
    showToast("Ja existe prazo com esse nome.");
    return;
  }
  state.paymentTerms[index] = cleanTerm;
  state.paymentRules.forEach((rule) => {
    if (rule.term === oldTerm) rule.term = cleanTerm;
  });
  state.customers.forEach((customer) => {
    if (customer.paymentTerm === oldTerm) customer.paymentTerm = cleanTerm;
  });
  state.orders.forEach((order) => {
    if (order.paymentTerm === oldTerm) order.paymentTerm = cleanTerm;
  });
  state.receivables.forEach((receivable) => {
    if (receivable.paymentTerm === oldTerm) receivable.paymentTerm = cleanTerm;
  });
  saveState();
  renderAll();
  showToast("Prazo salvo.");
}

function deletePaymentTerm(term) {
  if (state.paymentTerms.length <= 1) {
    showToast("Mantenha pelo menos um prazo cadastrado.");
    return;
  }
  const used = state.paymentRules.some((rule) => rule.term === term)
    || state.customers.some((customer) => customer.paymentTerm === term)
    || state.orders.some((order) => order.paymentTerm === term);
  if (used) {
    showToast("Nao e possivel excluir: prazo em uso.");
    return;
  }
  state.paymentTerms = state.paymentTerms.filter((item) => item !== term);
  saveState();
  renderAll();
  showToast("Prazo excluído.");
}

function addPaymentRule(type, referenceValue, payment, term, customerDocument = "") {
  if (type === "customer") {
    showToast("Regra por cliente deve ser alterada no cadastro do cliente.");
    return;
  }
  const referenceText = String(referenceValue || "").trim();
  if (!referenceText || !payment || !term) {
    showToast("Informe referencia, forma e prazo.");
    return;
  }
  let reference = referenceText;
  let documentValue = "";
  if (type === "customer") {
    const customer = findCustomer(customerDocument) || findCustomerByTerm(referenceText);
    if (!customer) {
      showToast("Cliente nao encontrado para criar regra.");
      return;
    }
    reference = customer.name;
    documentValue = customer.document;
  }
  upsertPaymentRule(type, reference, payment, term, documentValue);
  saveState();
  renderAll();
  showToast("Regra de prazo salva.");
}

function deletePaymentRule(ruleId) {
  state.paymentRules = state.paymentRules.filter((rule) => rule.id !== ruleId);
  saveState();
  renderAll();
  showToast("Regra de prazo excluida.");
}

function addSalesperson(name) {
  const cleanName = name.trim();
  if (!cleanName) return;
  if (state.salespeople.some((seller) => normalizeSearch(seller) === normalizeSearch(cleanName))) {
    showToast("Vendedor ja cadastrado.");
    return;
  }
  state.salespeople.push(cleanName);
  saveState();
  renderAll();
  showToast("Vendedor adicionado.");
}

function saveSalesperson(oldName, newName) {
  const cleanName = newName.trim();
  const index = state.salespeople.indexOf(oldName);
  if (index < 0 || !cleanName) return;
  const duplicate = state.salespeople.some((seller) => seller !== oldName && normalizeSearch(seller) === normalizeSearch(cleanName));
  if (duplicate) {
    showToast("Ja existe vendedor com esse nome.");
    return;
  }
  state.salespeople[index] = cleanName;
  state.orders.forEach((order) => {
    if (order.salesperson === oldName) order.salesperson = cleanName;
  });
  state.receivables.forEach((receivable) => {
    if (receivable.salesperson === oldName) receivable.salesperson = cleanName;
  });
  state.customers.forEach((customer) => {
    if (customer.salesperson === oldName) customer.salesperson = cleanName;
  });
  state.sellerCities.forEach((rule) => {
    if (rule.salesperson === oldName) rule.salesperson = cleanName;
  });
  state.paymentRules.forEach((rule) => {
    if (rule.type === "seller" && normalizeSearch(rule.reference) === normalizeSearch(oldName)) rule.reference = cleanName;
  });
  saveState();
  renderAll();
  showToast("Vendedor salvo.");
}

function deleteSalesperson(name) {
  if (state.salespeople.length <= 1) {
    showToast("Mantenha pelo menos um vendedor.");
    return;
  }
  const used = state.orders.some((order) => order.salesperson === name)
    || state.receivables.some((receivable) => receivable.salesperson === name)
    || state.customers.some((customer) => customer.salesperson === name)
    || state.sellerCities.some((rule) => rule.salesperson === name)
    || state.paymentRules.some((rule) => rule.type === "seller" && normalizeSearch(rule.reference) === normalizeSearch(name));
  if (used) {
    showToast("Nao e possivel excluir: vendedor ja usado em pedido.");
    return;
  }
  state.salespeople = state.salespeople.filter((seller) => seller !== name);
  saveState();
  renderAll();
  showToast("Vendedor excluído.");
}

function addDriver(name) {
  const cleanName = cleanDriverName(name);
  if (!cleanName) return;
  if (!isUsefulDriverName(cleanName)) {
    showToast("Informe o nome completo do motorista.");
    return;
  }
  if (state.drivers.some((driver) => normalizeSearch(driver) === normalizeSearch(cleanName))) {
    showToast("Motorista ja cadastrado.");
    return;
  }
  state.drivers.push(cleanName);
  state.drivers = cleanDriverOptions(state.drivers);
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast("Motorista adicionado.");
}

function saveDriver(oldName, newName) {
  const cleanName = cleanDriverName(newName);
  const index = state.drivers.indexOf(oldName);
  if (index < 0 || !cleanName) return;
  if (!isUsefulDriverName(cleanName)) {
    showToast("Informe o nome completo do motorista.");
    return;
  }
  const duplicate = state.drivers.some((driver) => driver !== oldName && normalizeSearch(driver) === normalizeSearch(cleanName));
  if (duplicate) {
    showToast("Ja existe motorista com esse nome.");
    return;
  }
  state.drivers[index] = cleanName;
  state.drivers = cleanDriverOptions(state.drivers);
  state.orders.forEach((order) => {
    if (normalizeSearch(order.driver) === normalizeSearch(oldName)) order.driver = cleanName;
  });
  state.stockEntries.forEach((entry) => {
    if (normalizeSearch(entry.loadedBy) === normalizeSearch(oldName)) entry.loadedBy = cleanName;
  });
  state.notes.forEach((note) => {
    if (normalizeSearch(note.loadedBy) === normalizeSearch(oldName)) note.loadedBy = cleanName;
  });
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast("Motorista salvo.");
}

function deleteDriver(name) {
  state.drivers = state.drivers.filter((driver) => driver !== name);
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast("Motorista excluido do cadastro.");
}

function addSellerCity(city, uf, salesperson) {
  const cleanCity = city.trim();
  const cleanUf = uf.trim().toUpperCase();
  if (!cleanCity || !state.salespeople.includes(salesperson)) {
    showToast("Informe cidade e vendedor.");
    return;
  }
  const duplicate = state.sellerCities.some((rule) => normalizeSearch(rule.city) === normalizeSearch(cleanCity) && normalizeSearch(rule.uf || "") === normalizeSearch(cleanUf));
  if (duplicate) {
    showToast("Cidade ja cadastrada para essa UF.");
    return;
  }
  state.sellerCities.push({
    id: `cidade-${Date.now()}`,
    city: cleanCity,
    uf: cleanUf,
    salesperson
  });
  saveState();
  renderAll();
  showToast("Cidade vinculada ao vendedor.");
}

function saveSellerCity(ruleId) {
  const rule = state.sellerCities.find((item) => item.id === ruleId);
  if (!rule) return;
  const city = qs(`[data-seller-city-name="${CSS.escape(ruleId)}"]`)?.value.trim();
  const uf = qs(`[data-seller-city-uf="${CSS.escape(ruleId)}"]`)?.value.trim().toUpperCase();
  const salesperson = qs(`[data-seller-city-salesperson="${CSS.escape(ruleId)}"]`)?.value;
  if (!city || !state.salespeople.includes(salesperson)) {
    showToast("Informe cidade e vendedor.");
    return;
  }
  const oldCity = rule.city;
  rule.city = city;
  rule.uf = uf || "";
  rule.salesperson = salesperson;
  state.paymentRules.forEach((paymentRule) => {
    if (paymentRule.type === "city" && normalizeSearch(paymentRule.reference) === normalizeSearch(oldCity)) {
      paymentRule.reference = city;
    }
  });
  saveState();
  renderAll();
  showToast("Cidade salva.");
}

function deleteSellerCity(ruleId) {
  state.sellerCities = state.sellerCities.filter((rule) => rule.id !== ruleId);
  saveState();
  renderAll();
  showToast("Cidade removida.");
}

function addFinancialAccount(name) {
  const cleanName = name.trim();
  if (!cleanName) return;
  state.financialAccounts.push({ id: makeId(cleanName), name: cleanName, balance: 0 });
  saveState();
  renderAll();
  showToast("Conta financeira adicionada.");
}

function saveFinancialAccount(accountId, name) {
  const account = state.financialAccounts.find((item) => item.id === accountId);
  if (!account) return;
  account.name = name.trim() || account.name;
  saveState();
  renderAll();
  showToast("Conta financeira salva.");
}

function deleteFinancialAccount(accountId) {
  const used = state.receivables.some((item) => item.accountId === accountId);
  if (used) {
    showToast("Esta conta ja foi usada em baixa financeira.");
    return;
  }
  state.financialAccounts = state.financialAccounts.filter((item) => item.id !== accountId);
  saveState();
  renderAll();
  showToast("Conta financeira excluida.");
}

function updateOrderLogisticsField(orderId, field, value) {
  const allowed = ["driver", "deliveryForecast", "deliveryNote"];
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || !allowed.includes(field)) return;
  order[field] = value.trim();
  saveState();
}

function nextOrderId(prefix = "PV") {
  const usedOrderIds = state.orders.map((order) => order.id).filter(Boolean);
  const deletedOrderIds = (state.deletedOrders || [])
    .map((record) => record.orderId || record.id)
    .filter(Boolean);
  const reusableId = (state.reusableOrderIds || [])
    .filter((id) => String(id || "").toUpperCase().startsWith(`${prefix.toUpperCase()}-`))
    .filter((id) => !usedOrderIds.includes(id))
    .filter((id) => !deletedOrderIds.includes(id))
    .sort((a, b) => Number(String(a).split("-").pop()) - Number(String(b).split("-").pop()))[0];
  if (reusableId) return reusableId;
  const orderIdsForSequence = [...usedOrderIds, ...deletedOrderIds];
  const maxNumber = orderIdsForSequence.reduce((max, orderId) => {
    const id = String(orderId || "");
    if (!/^PVN?-\d+$/i.test(id)) return max;
    const number = Number(id.split("-").pop());
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);
  return `${prefix}-${String(maxNumber + 1).padStart(2, "0")}`;
}

function createDirectOrderFromEntry(entryId) {
  const entry = state.stockEntries.find((item) => item.id === entryId);
  if (!entry) return;
  const remaining = entryRemainingQuantity(entry);
  if (remaining <= 0.009) {
    showToast("A quantidade desta nota ja foi totalmente distribuida.");
    return;
  }
  const product = findStockProductForEntry(entry)
    || findStockProductByName(entry.product);
  if (!product) {
    showToast("Produto da nota nao encontrado no estoque.");
    return;
  }

  resetSaleForm();
  sourceEntryForOrderId = entry.id;
  sourceEntryDistributionEnabled = Boolean(entry.distributionStarted);
  setSaleExtraItemsVisible(false);
  qs('[data-view="pedidos"]').click();
  qs("#sale-product").value = product.id;
  setSaleProductLocked(true);
  qs("#sale-stock-location").value = "Divinopolis";
  qs("#sale-stock-location").disabled = true;
  qs('[name="driver"]').value = cleanDriverName(entry.loadedBy) || "";
  qs('[name="quantity"]').value = remaining;
  qs('[name="quantity"]').max = remaining;
  qs('[name="price"]').value = "0.00";
  qs("#sale-form-title").textContent = `Novo pedido pela NF-e ${entry.invoice}`;
  qs("#sale-edit-tag").textContent = "Vinculado a nota";
  qs("#sale-submit-btn").textContent = "Salvar pedido vinculado";
  showDirectLoadInfo(entry.invoice || "", entry.factoryOrder || "", entry);
  renderSaleProductOptions();
  qs("#sale-product").value = product.id;
  setSaleProductLocked(true);
  qs("#sale-form").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(`Pedido aberto como carga direta. Saldo disponivel: ${formatQty(remaining)}.`);
}

function createDirectOrderFromEntryGroup(entryIdsValue) {
  const entries = String(entryIdsValue || "")
    .split(",")
    .map((entryId) => state.stockEntries.find((item) => item.id === entryId))
    .filter((entry) => entry && entryRemainingQuantity(entry) > 0.009);
  if (!entries.length) {
    showToast("A quantidade desta nota ja foi totalmente distribuida.");
    return;
  }
  const firstEntry = entries[0];
  const firstProduct = findStockProductForEntry(firstEntry);
  if (!firstProduct) {
    showToast("Produto da nota nao encontrado no estoque.");
    return;
  }
  const totalRemaining = entries.reduce((sum, entry) => sum + entryRemainingQuantity(entry), 0);

  resetSaleForm();
  sourceEntryForOrderId = firstEntry.id;
  sourceEntryGroupForOrderIds = entries.map((entry) => entry.id);
  sourceEntryDistributionEnabled = entries.some((entry) => entry.distributionStarted);
  setSaleExtraItemsVisible(false);
  qs('[data-view="pedidos"]').click();
  qs("#sale-product").value = firstProduct.id;
  setSaleProductLocked(true);
  qs("#sale-stock-location").value = "Divinopolis";
  qs("#sale-stock-location").disabled = true;
  qs('[name="driver"]').value = cleanDriverName(firstEntry.loadedBy) || "";
  qs('[name="quantity"]').value = totalRemaining;
  qs('[name="quantity"]').max = totalRemaining;
  qs('[name="price"]').value = "0.00";
  qs("#sale-form-title").textContent = `Novo pedido unico pela NF-e ${firstEntry.invoice}`;
  qs("#sale-edit-tag").textContent = "Vinculado a nota";
  qs("#sale-submit-btn").textContent = "Salvar pedido unico";
  showDirectLoadInfo(firstEntry.invoice || "", firstEntry.factoryOrder || "", firstEntry);
  renderDirectLoadItems(entries);
  updateDirectLoadItemTotals();
  renderSaleProductOptions();
  qs("#sale-product").value = firstProduct.id;
  setSaleProductLocked(true);
  qs("#sale-form").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(`Pedido unico aberto com ${entries.length} produto(s). Saldo total: ${formatQty(totalRemaining)}.`);
}

function updateStockEntryDestination(entryId, nextLocationValue) {
  const entry = state.stockEntries.find((item) => item.id === entryId);
  if (!entry) return;
  if (!nextLocationValue || !stockLocations.includes(nextLocationValue)) {
    renderStockEntries();
    return;
  }
  const remaining = entryRemainingQuantity(entry);
  if (remaining <= 0.009) {
    showToast("A quantidade desta nota ja foi totalmente distribuida.");
    renderStockEntries();
    return;
  }
  if (!assertStockDateUnlocked(entry.date, "lancar esta nota no estoque")) {
    renderStockEntries();
    return;
  }

  beginEntryDistribution(entry);
  let product = findStockProductForEntry(entry);
  if (product) {
    changeProductLocationQty(product, nextLocationValue, remaining);
  } else {
    product = ensureStockProduct(entry.product, entry.supplier || entry.brand || "Fornecedor importado", entry.invoice);
    changeProductLocationQty(product, nextLocationValue, remaining);
  }
  entryAllocations(entry).push({
    id: `ALOC-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    type: "stock",
    location: nextLocationValue,
    qty: remaining
  });
  state.movements.unshift({
    date: today,
    op: `Saldo da NF ${entry.invoice} para ${nextLocationValue}`,
    product: entry.product,
    qty: remaining
  });
  updateInvoiceDistributionStatus(entry);

  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast(`Saldo de ${formatQty(remaining)} lancado no estoque de ${nextLocationValue}.`);
}

function reverseStockEntryToAvailable(entryId) {
  const entry = state.stockEntries.find((item) => item.id === entryId);
  if (!entry) {
    showToast("Nota fiscal nao encontrada para estorno.");
    return;
  }
  const quantity = Number(entry.quantity || 0);
  const location = normalizeStockLocationOrBlank(entry.location);
  if (!isInvoiceStockEntry(entry) || entry.distributionStarted || !location || quantity <= 0) {
    showToast("Esta entrada nao esta disponivel para estorno direto.");
    return;
  }
  if (!assertStockDateUnlocked(entry.date, "estornar esta entrada")) return;

  const product = findStockProductForEntry(entry)
    || findStockProductByName(entry.product);
  if (product && productAvailableQty(product, location) < quantity) {
    showToast("Saldo insuficiente na unidade para estornar esta entrada.");
    return;
  }
  if (!window.confirm(`Estornar ${formatQty(quantity)} da NF ${entry.invoice} no estoque de ${location}?`)) {
    return;
  }

  if (product) changeProductLocationQty(product, location, -quantity);
  const oldLocation = location;
  entry.location = "";
  entry.generatedOrderId = "";
  entry.linkedOrderId = "";
  entry.stockPosted = false;
  entry.destination = "";
  entry.distributionStarted = false;
  entry.allocations = [];
  state.movements.unshift({
    date: today,
    op: `Estorno da NF ${entry.invoice} do estoque ${oldLocation}`,
    product: entry.product,
    qty: -quantity,
    sourceEntryId: entry.id,
    sourceInvoice: entry.invoice || ""
  });
  updateInvoiceDistributionStatus(entry);
  const entryDateFilter = qs("#stock-entry-date-filter");
  if (entryDateFilter) entryDateFilter.value = entry.date || today;
  const entryLinkFilter = qs("#stock-entry-link-filter");
  if (entryLinkFilter) entryLinkFilter.value = "";

  saveState();
  saveStateToCloudNow();
  renderAll();
  if (selectedStockProductId) renderStockLedger(selectedStockProductId);
  showToast(`Estorno realizado. NF ${entry.invoice} voltou para entradas disponiveis.`);
}

function reverseStockEntryAllocation(entryId, allocationId) {
  const entry = state.stockEntries.find((item) => item.id === entryId);
  if (!entry) {
    showToast("Nota fiscal nao encontrada para estorno.");
    return;
  }
  const allocations = entryAllocations(entry);
  const allocationIndex = allocations.findIndex((item) => item.id === allocationId && item.type === "stock");
  if (allocationIndex < 0) {
    showToast("Entrada em unidade nao encontrada para estorno.");
    return;
  }
  const allocation = allocations[allocationIndex];
  const quantity = Number(allocation.qty || 0);
  const location = normalizeLocation(allocation.location);
  if (!quantity || quantity <= 0 || !stockLocations.includes(location)) {
    showToast("Entrada invalida para estorno.");
    return;
  }
  if (!assertStockDateUnlocked(entry.date, "estornar esta entrada")) return;
  if (!window.confirm(`Estornar ${formatQty(quantity)} da NF ${entry.invoice} no estoque de ${location}?`)) {
    return;
  }

  let product = findStockProductForEntry(entry)
    || findStockProductByName(entry.product);
  if (product) {
    changeProductLocationQty(product, location, -quantity);
  }
  allocations.splice(allocationIndex, 1);
  if (!allocations.length) {
    entry.distributionStarted = false;
    entry.location = "";
    entry.generatedOrderId = "";
    entry.linkedOrderId = "";
  }
  state.movements.unshift({
    date: today,
    op: `Estorno da NF ${entry.invoice} do estoque ${location}`,
    product: entry.product,
    qty: -quantity,
    sourceEntryId: entry.id,
    sourceInvoice: entry.invoice || "",
    allocationId
  });
  updateInvoiceDistributionStatus(entry);
  const entryDateFilter = qs("#stock-entry-date-filter");
  if (entryDateFilter) entryDateFilter.value = entry.date || today;
  const entryLinkFilter = qs("#stock-entry-link-filter");
  if (entryLinkFilter) entryLinkFilter.value = "";

  saveState();
  saveStateToCloudNow();
  renderAll();
  if (selectedStockProductId) renderStockLedger(selectedStockProductId);
  showToast(`Estorno realizado. Saldo da NF ${entry.invoice} voltou a ficar disponivel.`);
}

function reverseStockEntryWarehouseDestination(entryId) {
  const entry = state.stockEntries.find((item) => item.id === entryId);
  if (!entry) {
    showToast("Nota fiscal nao encontrada para estorno.");
    return;
  }
  const stockAllocations = stockEntryReversibleStockAllocations(entry);
  if (!stockAllocations.length) {
    showToast("Esta nota nao tem entrada em unidade para estornar.");
    return;
  }
  if (!assertStockDateUnlocked(entry.date, "estornar esta entrada")) return;

  const totalQty = stockAllocations.reduce((sum, allocation) => sum + Number(allocation.qty || 0), 0);
  const locationsText = [...new Set(stockAllocations.map((allocation) => allocation.location))].join(", ");
  if (!window.confirm(`Estornar ${formatQty(totalQty)} da NF ${entry.invoice} no estoque de ${locationsText}?`)) {
    return;
  }

  const product = findStockProductForEntry(entry) || findStockProductByName(entry.product);
  stockAllocations.forEach((allocation) => {
    if (!product) return;
    const availableQty = productAvailableQty(product, allocation.location);
    const qtyToRemove = Math.min(availableQty, Number(allocation.qty || 0));
    if (qtyToRemove > 0) changeProductLocationQty(product, allocation.location, -qtyToRemove);
  });

  if (stockAllocations.some((allocation) => allocation.direct)) {
    entry.location = "";
    entry.generatedOrderId = "";
    entry.linkedOrderId = "";
    entry.stockPosted = false;
    entry.destination = "";
    entry.distributionStarted = false;
    entry.allocations = [];
  } else {
    const allocationIds = new Set(stockAllocations.map((allocation) => allocation.id));
    entry.allocations = entryAllocations(entry).filter((allocation) => {
      if (allocation.type !== "stock") return true;
      return !allocationIds.has(allocation.id);
    });
    if (!entry.allocations.length) {
      entry.distributionStarted = false;
      entry.location = "";
      entry.generatedOrderId = "";
      entry.linkedOrderId = "";
      entry.stockPosted = false;
      entry.destination = "";
    }
  }

  updateInvoiceDistributionStatus(entry);
  const entryDateFilter = qs("#stock-entry-date-filter");
  if (entryDateFilter) entryDateFilter.value = entry.date || today;
  const entryLinkFilter = qs("#stock-entry-link-filter");
  if (entryLinkFilter) entryLinkFilter.value = "";

  saveState();
  saveStateToCloudNow();
  renderAll();
  if (selectedStockProductId) renderStockLedger(selectedStockProductId);
  showToast(`Estorno realizado. NF ${entry.invoice} voltou para entradas disponiveis.`);
}

function reverseStockTransfer(documentNumber) {
  const transferEntries = state.stockEntries.filter((entry) => entry.invoice === documentNumber);
  if (transferEntries.length < 2) {
    showToast("Transferencia nao encontrada para estorno.");
    return;
  }

  const destinationEntry = transferEntries.find((entry) => Number(entry.quantity || 0) > 0);
  const originEntry = transferEntries.find((entry) => Number(entry.quantity || 0) < 0);
  if (!destinationEntry || !originEntry) {
    showToast("Transferencia incompleta para estorno.");
    return;
  }

  const quantity = Number(destinationEntry.quantity || 0);
  const destination = normalizeStockLocationOrBlank(destinationEntry.location);
  const origin = normalizeStockLocationOrBlank(originEntry.location);
  if (!quantity || quantity <= 0 || !destination || !origin) {
    showToast("Transferencia invalida para estorno.");
    return;
  }
  if (!assertStockDateUnlocked(destinationEntry.date, "estornar esta transferencia")) return;

  const product = findStockProductForEntry(destinationEntry)
    || findStockProductByName(destinationEntry.product);
  if (product && productAvailableQty(product, destination) < quantity) {
    showToast("Saldo insuficiente no destino para estornar esta transferencia.");
    return;
  }
  if (!window.confirm(`Estornar a transferencia ${documentNumber} de ${formatQty(quantity)}?`)) return;

  if (product) {
    changeProductLocationQty(product, destination, -quantity);
    changeProductLocationQty(product, origin, quantity);
  }
  state.stockEntries = state.stockEntries.filter((entry) => entry.invoice !== documentNumber);
  state.movements = state.movements.filter((movement) => !(
    normalizeSearch(movement.op).includes("transferencia")
    && normalizeSearch(movement.op).includes(normalizeSearch(origin))
    && normalizeSearch(movement.op).includes(normalizeSearch(destination))
    && normalizeSearch(movement.product) === normalizeSearch(destinationEntry.product)
    && Number(movement.qty || 0) === quantity
  ));

  saveState();
  saveStateToCloudNow();
  renderAll();
  if (selectedStockProductId) renderStockLedger(selectedStockProductId);
  showToast(`Transferencia ${documentNumber} estornada.`);
}

function deleteOrder(orderId, reasonValue = "") {
  const reason = String(reasonValue || "").trim();
  if (!reason) {
    showToast("Informe a observacao da exclusão.");
    return;
  }
  const orderIndex = state.orders.findIndex((item) => item.id === orderId);
  if (orderIndex < 0) return;
  const order = state.orders[orderIndex];
  if (!window.confirm(`Excluir o pedido ${orderId}? Esta acao ficara registrada.`)) return;

  if (order.stockPosted && !order.directLoad) {
    changeOrderItemsStock(order, 1, "Exclusao de pedido");
    order.stockPosted = false;
  }

  state.deletedOrders.unshift({
    id: `EXC-${Date.now()}`,
    orderId: order.id,
    orderDate: order.date,
    customer: order.customer,
    value: Number(order.value || 0),
    reason,
    deletedAt: new Date().toISOString(),
    deletedBy: getLoggedUser()?.name || "Operador do sistema",
    order: { ...order }
  });
  state.orders.splice(orderIndex, 1);
  state.stockEntries.forEach((entry) => {
    if (Array.isArray(entry.allocations)) {
      entry.allocations = entry.allocations.filter((allocation) => allocation.orderId !== orderId);
      const firstOrderAllocation = entry.allocations.find((allocation) => allocation.type === "order");
      if (entry.generatedOrderId === orderId) entry.generatedOrderId = firstOrderAllocation?.orderId || "";
      if (entry.linkedOrderId === orderId) entry.linkedOrderId = firstOrderAllocation?.orderId || "";
      if (entry.sourceEntryId === order.sourceEntryId || entry.id === order.sourceEntryId) {
        updateInvoiceDistributionStatus(entry);
      }
    }
    if (entry.generatedOrderId === orderId) entry.generatedOrderId = "";
    if (entry.linkedOrderId === orderId) entry.linkedOrderId = "";
  });
  state.notes.forEach((note) => {
    if (Array.isArray(note.linkedOrderIds)) {
      note.linkedOrderIds = note.linkedOrderIds.filter((id) => id !== orderId);
    }
    if (note.linkedOrderId === orderId) {
      note.linkedOrderId = note.linkedOrderIds?.[0] || "";
    }
  });
  state.receivables = state.receivables.filter((item) => item.origin !== orderId);
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast("Pedido excluído e registrado no historico.");
}

function orderPrintHtml(order) {
  const date = formatOrderPrintDateTime(order);
  const logoSrc = new URL("./logo-nova.jpeg", window.location.href).href;
  const printItems = orderItems(order);
  const itemsRows = printItems.map((item) => `
    <tr>
      <td>${escapeHtml(item.product || "-")}</td>
      <td class="right">${formatQty(item.qty)}</td>
      <td class="right">${money.format(Number(item.price || 0))}</td>
      <td class="right">${money.format(Number(item.value || 0))}</td>
    </tr>
  `).join("");
  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>Pedido ${order.id}</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          body { font-family: Arial, sans-serif; color: #17211b; margin: 0; text-transform: uppercase; }
          .receipt { width: 100%; max-height: 132mm; }
          .head { display: grid; justify-items: center; text-align: center; gap: 2px; border-bottom: 2px solid #17211b; padding-bottom: 4px; margin-bottom: 6px; }
          .print-logo { width: 125px; height: 74px; object-fit: contain; }
          .order-title { font-size: 12px; font-weight: 800; }
          .box { border: 1px solid #dce4dc; border-radius: 6px; padding: 6px; margin-bottom: 6px; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; }
          th, td { border-bottom: 1px solid #dce4dc; padding: 5px; text-align: left; }
          .right { text-align: right; }
          .total { font-size: 14px; font-weight: 700; margin: 6px 0 0; }
          .signatures { display: grid; grid-template-columns: 1fr; width: 72%; max-width: 430px; margin: 34px auto 0; font-size: 12px; }
          .line { border-top: 1px solid #17211b; padding-top: 8px; text-align: center; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Imprimir agora</button>
        <div class="receipt">
          <div class="head">
            <img class="print-logo" src="${logoSrc}" alt="Cimento & Cia">
            <div class="order-title">Pedido de venda ${order.id} | Data: ${date}</div>
          </div>
          <section class="box">
            <strong>Cliente</strong><br>
            ${order.customer}<br>
            CPF/CNPJ: ${formatDocument(order.customerDoc)}<br>
            Endereco: ${order.address || "-"}<br>
            Telefone: ${order.phone || "-"}
          </section>
          <section class="box">
            <strong>Itens do pedido</strong>
            <table>
              <thead>
                <tr><th>Produto</th><th class="right">Qtd.</th><th class="right">Unit.</th><th class="right">Total</th></tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
            <p class="right total">Total: ${money.format(order.value)}</p>
          </section>
          <section class="box">
            <strong>Informações internas</strong><br>
            Vendedor: ${order.salesperson || "Nao informado"}<br>
            Motorista: ${cleanDriverName(order.driver) || "Nao informado"}<br>
            Unidade do estoque: ${order.directLoad ? "Carga direta vinculada a NF" : normalizeLocation(order.stockLocation)}<br>
            Forma de pagamento: ${order.payment || "-"}${order.paymentTerm ? ` - Prazo ${order.paymentTerm}` : ""}<br>
            NF vinculada: ${order.sourceInvoice || "-"}<br>
            Observação: ${order.observation || "-"}
          </section>
          <div class="signatures">
            <div class="line">Assinatura do cliente</div>
          </div>
        </div>
        <script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>
      </body>
    </html>
  `;
}

function printOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  if (!order.issuedAt) {
    order.issuedAt = new Date().toISOString();
    saveState();
  }
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    showToast("Libere pop-ups para imprimir o pedido.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(orderPrintHtml(order));
  printWindow.document.close();
}

function importedItemQuantityInBags(det) {
  const rawQuantity = Number(det.querySelector("qCom")?.textContent?.replace(",", ".") || 0);
  const unit = normalizeSearch(det.querySelector("uCom")?.textContent || det.querySelector("uTrib")?.textContent || "");
  const productName = det.querySelector("xProd")?.textContent?.trim() || "";
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return 0;

  // Algumas NF-e de cimento vêm em tonelada. O estoque/pedidos do sistema trabalham em sacos.
  // Para produtos 50kg: 1 tonelada = 20 sacos. Para 40kg: 1 tonelada = 25 sacos.
  const kgMatch = productName.match(/(40|50)\s*kg/i);
  const kgPerBag = kgMatch ? Number(kgMatch[1]) : 50;
  const bagsPerTon = 1000 / kgPerBag;
  const isTon = ["ton", "tonelada", "toneladas", "t"].includes(unit);
  const isBag = ["sc", "saco", "sacos", "un", "und", "unid", "unidade", "unidades"].includes(unit);

  if (isTon) return rawQuantity * bagsPerTon;
  if (isBag) return rawQuantity;
  return rawQuantity;
}

function parseNfeXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("XML invalido.");

  const getText = (selector, fallback = "") => doc.querySelector(selector)?.textContent?.trim() || fallback;
  const items = Array.from(doc.querySelectorAll("det")).map((det) => ({
    product: det.querySelector("xProd")?.textContent?.trim() || "Produto sem descricao",
    quantity: importedItemQuantityInBags(det),
    invoiceQuantity: Number(det.querySelector("qCom")?.textContent?.replace(",", ".") || 0),
    invoiceUnit: det.querySelector("uCom")?.textContent?.trim() || det.querySelector("uTrib")?.textContent?.trim() || "",
    brand: detectBrand(det.querySelector("xProd")?.textContent?.trim() || "", getText("emit xNome", ""))
  })).filter((item) => item.quantity > 0);
  const observation = [
    getText("infAdic infCpl", ""),
    getText("infAdic infAdFisco", "")
  ].filter(Boolean).join(" ");
  const metadata = extractNoteMetadata(observation);

  return {
    number: getText("nNF", `NF-${Date.now().toString().slice(-4)}`),
    supplier: getText("emit xNome", "Fornecedor nao identificado"),
    recipientDocument: cleanDocument(getText("dest CNPJ", "") || getText("dest CPF", "")),
    issueDateTime: getText("dhEmi", getText("dEmi", today)),
    issue: getText("dhEmi", today).slice(0, 10),
    items,
    ...metadata
  };
}

function importNote(xmlText, details = {}) {
  const note = parseNfeXml(xmlText);
  if (note.recipientDocument !== acceptedRecipientDocument) {
    if (!details.silent) showToast("XML recusado: destinatario diferente do CNPJ 04.152.053/0001-89.");
    return { ok: false, reason: "destinatario" };
  }
  note.items = uniqueImportedNoteItems(note.items);
  if (!note.items.length) {
    if (!details.silent) showToast("Nenhum item de cimento encontrado no XML.");
    return { ok: false, reason: "sem_itens" };
  }

  const alreadyImported = state.notes.some((item) => {
    return item.number === note.number && normalizeSearch(item.supplier) === normalizeSearch(note.supplier);
  }) || state.stockEntries.some((entry) => {
    return entry.invoice === note.number && normalizeSearch(entry.supplier) === normalizeSearch(note.supplier);
  });
  if (alreadyImported) {
    if (!details.silent) showToast(`NF-e ${note.number} ja foi importada.`);
    return { ok: false, reason: "duplicada", number: note.number };
  }

  const ovNumber = note.ovNumber || "";
  const factoryOrder = ovNumber || details.factoryOrder || "Nao informado";
  const loadedBy = cleanDriverName(note.loadedBy) || cleanDriverName(details.loadedBy) || "Nao informado";
  const entryDate = note.issue;
  const location = normalizeLocation(details.location);

  note.items.forEach((item) => {
    addStock(item.product, item.quantity, note.supplier, note.number, location);
    state.stockEntries.unshift({
      id: `ENT-${note.number}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      date: entryDate,
      issueDateTime: note.issueDateTime || entryDate,
      importedAt: new Date().toISOString(),
      invoice: note.number,
      factoryOrder,
      location,
      linkedOrderId: "",
      ovNumber,
      product: item.product,
      quantity: item.quantity,
      invoiceQuantity: item.invoiceQuantity,
      invoiceUnit: item.invoiceUnit,
      brand: item.brand,
      loadedBy,
      supplier: note.supplier,
      observation: note.observation || ""
    });
  });
  cleanupDuplicateImportedStockEntries();
  state.notes.unshift({
    number: note.number,
    supplier: note.supplier,
    issueDateTime: note.issueDateTime || note.issue,
    issue: note.issue,
    items: note.items.length,
    status: "Importada",
    linkedOrderId: "",
    ovNumber,
    factoryOrder,
    loadedBy,
    location
  });
  if (!details.silent) {
    saveState();
    saveStateToCloudNow();
    renderAll();
    showToast(`NF-e ${note.number} importada e estoque atualizado.`);
  }
  return { ok: true, note };
}

function deleteImportedNote(noteIndex, noteNumber = "", noteSupplierValue = "") {
  let realNoteIndex = Number(noteIndex);
  let note = state.notes[realNoteIndex];
  if (!note && noteNumber) {
    const supplierKey = normalizeSearch(noteSupplierValue);
    realNoteIndex = state.notes.findIndex((item) => item.number === noteNumber && (!supplierKey || normalizeSearch(item.supplier) === supplierKey));
    note = state.notes[realNoteIndex];
  }
  if (!note && noteNumber) {
    const supplierKey = normalizeSearch(noteSupplierValue);
    const entry = state.stockEntries.find((item) => item.invoice === noteNumber && (!supplierKey || normalizeSearch(item.supplier) === supplierKey));
    if (entry) {
      note = {
        number: entry.invoice,
        supplier: entry.supplier,
        linkedOrderId: entry.linkedOrderId || entry.generatedOrderId || ""
      };
      realNoteIndex = -1;
    }
  }
  if (!note) return;
  const noteSupplier = normalizeSearch(note.supplier);
  const entries = state.stockEntries.filter((entry) => {
    return entry.invoice === note.number && normalizeSearch(entry.supplier) === noteSupplier;
  });
  const hasLinkedUse = entries.some((entry) => entry.generatedOrderId
    || entry.linkedOrderId
    || entryAllocations(entry).length);
  if (hasLinkedUse || note.linkedOrderId) {
    showToast("Nao e possivel excluir: esta nota esta vinculada a pedido.");
    return;
  }
  if (entries.some((entry) => isStockDateLocked(entry.date))) {
    showToast(`Estoque travado ate ${formatDateBR(state.stockLockDate)}. Nao e possivel excluir nota dessa data.`);
    return;
  }

  entries.forEach((entry) => {
    const product = findStockProductForEntry(entry);
    const quantity = Number(entry.quantity || 0);
    if (product && quantity > 0) {
      changeProductLocationQty(product, entry.location, -quantity);
      state.movements.unshift({
        date: today,
        op: `Exclusao NF ${note.number} ${normalizeLocation(entry.location)}`,
        product: entry.product,
        qty: -quantity
      });
    }
  });

  state.stockEntries = state.stockEntries.filter((entry) => {
    return !(entry.invoice === note.number && normalizeSearch(entry.supplier) === noteSupplier);
  });
  if (realNoteIndex >= 0) state.notes.splice(realNoteIndex, 1);
  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast(`NF-e ${note.number} excluida.`);
}

async function importXmlFiles(files) {
  const xmlFiles = Array.from(files || []);
  if (!xmlFiles.length) return;
  let imported = 0;
  let duplicated = 0;
  let refused = 0;
  let failed = 0;

  for (const file of xmlFiles) {
    try {
      const result = importNote(await file.text(), {
        loadedBy: qs("#note-loader").value,
        factoryOrder: qs("#factory-order").value,
        location: qs("#note-stock-location").value,
        silent: true
      });
      if (result?.ok) imported += 1;
      else if (result?.reason === "duplicada") duplicated += 1;
      else refused += 1;
    } catch (error) {
      failed += 1;
    }
  }

  saveState();
  saveStateToCloudNow();
  renderAll();
  showToast(`${imported} XML importados. ${duplicated} duplicados, ${refused} recusados, ${failed} com erro.`);
}

function importSefazNotes() {
  const cnpj = cleanDocument(qs("#company-cnpj").value);
  const certificate = qs("#digital-certificate").files[0];
  const password = qs("#certificate-password").value;

  if (cnpj.length !== 14) {
    showToast("Informe o CNPJ da empresa com 14 numeros.");
    return;
  }
  if (!certificate || !password) {
    showToast("Informe o certificado digital A1 e a senha.");
    return;
  }

  qs("#sefaz-import-status").textContent = "Consultando API/SEFAZ";
  let imported = 0;
  let ignored = 0;

  sefazSampleXmls.forEach((xmlText) => {
    const note = parseNfeXml(xmlText);
    if (normalizeSearch(note.supplier) !== normalizeSearch(certificateSupplierFilter)) {
      ignored += 1;
      return;
    }

    imported += 1;
    importNote(xmlText, {
      loadedBy: qs("#sefaz-loader").value,
      factoryOrder: "",
      location: qs("#sefaz-stock-location").value
    });
  });

  qs("#sefaz-import-status").textContent = `${imported} importadas / ${ignored} ignoradas`;
  showToast(`Consulta concluida. Importadas somente notas da ${certificateSupplierFilter}.`);
}

function showConfigTab(tabName) {
  qsa("[data-config-tab-button]").forEach((button) => {
    button.classList.toggle("active", button.dataset.configTabButton === tabName);
  });
  qsa("[data-config-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.configTabPanel !== tabName;
  });
}

function showClientTab(tabName) {
  qsa("[data-client-tab-button]").forEach((button) => {
    button.classList.toggle("active", button.dataset.clientTabButton === tabName);
  });
  qsa("[data-client-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.clientTabPanel !== tabName;
  });
}

function bindEvents() {
  qs("#stock-search").addEventListener("input", renderStock);
  qs("#daily-load-date").addEventListener("input", renderDailyLoadBoard);
  qs("#dashboard-lock-date").addEventListener("input", renderDashboardLockSettings);
  qs("#dashboard-config-lock-btn").addEventListener("click", toggleDashboardDateLock);
  qs("#stock-lock-date")?.addEventListener("input", renderStockLockSettings);
  qs("#save-stock-lock-btn")?.addEventListener("click", saveStockLockDate);
  qs("#clear-stock-lock-btn")?.addEventListener("click", clearStockLockDate);
  qs("#daily-load-grid").addEventListener("change", (event) => {
    const input = event.target.closest("[data-load-panel-date]");
    if (!input) return;
    updateDailyLoadPanelDate(input.dataset.loadPanelDate, input.value);
  });
  qs("#daily-load-grid").addEventListener("dragstart", (event) => {
    if (isDashboardDateLocked(qs("#daily-load-date")?.value || today)) {
      event.preventDefault();
      return;
    }
    const card = event.target.closest("[data-load-entry]");
    if (!card || event.target.closest("input, select, button")) return;
    event.dataTransfer.setData("text/plain", card.dataset.loadEntry);
    event.dataTransfer.effectAllowed = "move";
  });
  qs("#daily-load-grid").addEventListener("dragover", (event) => {
    if (isDashboardDateLocked(qs("#daily-load-date")?.value || today)) return;
    const slot = event.target.closest("[data-load-slot]");
    if (!slot) return;
    event.preventDefault();
  });
  qs("#daily-load-grid").addEventListener("drop", (event) => {
    if (isDashboardDateLocked(qs("#daily-load-date")?.value || today)) return;
    const slot = event.target.closest("[data-load-slot]");
    if (!slot) return;
    event.preventDefault();
    const entryId = event.dataTransfer.getData("text/plain");
    if (entryId) moveDailyLoadEntry(entryId, slot.dataset.loadSlot);
  });
  qs("#stock-location-filter").addEventListener("change", renderStock);
  qs("#stock-ledger-date-filter").addEventListener("input", () => {
    renderStockLedger(selectedStockProductId);
  });
  qs("#clear-stock-ledger-filter").addEventListener("click", () => {
    qs("#stock-ledger-date-filter").value = today;
    renderStockLedger(selectedStockProductId);
  });
  [
    "#stock-entry-date-filter",
    "#stock-entry-driver-filter",
    "#stock-entry-invoice-filter",
    "#stock-entry-order-filter",
    "#stock-entry-link-filter",
    "#stock-entry-general-filter"
  ].forEach((selector) => {
    qs(selector).addEventListener("input", renderStockEntries);
    qs(selector).addEventListener("change", renderStockEntries);
  });
  qs("#clear-stock-entry-filter").addEventListener("click", () => {
    [
      "#stock-entry-date-filter",
      "#stock-entry-driver-filter",
      "#stock-entry-invoice-filter",
      "#stock-entry-order-filter",
      "#stock-entry-link-filter",
      "#stock-entry-general-filter"
    ].forEach((selector) => {
      qs(selector).value = "";
    });
    qs("#stock-entry-date-filter").value = today;
    renderStockEntries();
  });
  qs("#stock-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stock-ledger]");
    if (!button) return;
    selectedStockProductId = button.dataset.stockLedger;
    renderStockLedger(selectedStockProductId);
  });
  qs("#stock-ledger-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stock-ledger-reversal], [data-stock-ledger-entry-reversal], [data-stock-ledger-transfer-reversal]");
    if (!button) return;
    event.stopPropagation();
    if (button.dataset.stockLedgerTransferReversal) {
      reverseStockTransfer(button.dataset.stockLedgerTransferReversal);
      return;
    }
    if (button.dataset.stockLedgerEntryReversal) {
      reverseStockEntryToAvailable(button.dataset.stockLedgerEntryReversal);
      return;
    }
    const [entryId, allocationId] = button.dataset.stockLedgerReversal.split(":");
    reverseStockEntryAllocation(entryId, allocationId);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#stock-ledger-action-menu")
      && !event.target.closest("[data-stock-ledger-reversal], [data-stock-ledger-entry-reversal], [data-stock-ledger-transfer-reversal]")) {
      closeStockLedgerActionMenu();
    }
  });
  qs("#manual-stock-settings-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-manual-stock]");
    if (button) deleteManualStockMovement(button.dataset.deleteManualStock);
  });
  qs("#stock-entries-table").addEventListener("click", (event) => {
    const invoiceButton = event.target.closest("[data-stock-entry-orders]");
    if (invoiceButton) {
      openInvoiceOrders(invoiceButton.dataset.stockEntryOrders);
      return;
    }
    const groupButton = event.target.closest("[data-direct-order-group]");
    if (groupButton) {
      createDirectOrderFromEntryGroup(groupButton.dataset.directOrderGroup);
      return;
    }
    const unitButton = event.target.closest("[data-stock-entry-unit]");
    if (unitButton) {
      const [entryId, location] = unitButton.dataset.stockEntryUnit.split(":");
      updateStockEntryDestination(entryId, location);
      return;
    }
    const reverseEntryButton = event.target.closest("[data-reverse-stock-entry]");
    if (reverseEntryButton) {
      reverseStockEntryWarehouseDestination(reverseEntryButton.dataset.reverseStockEntry);
      return;
    }
    const button = event.target.closest("[data-direct-order-entry]");
    if (!button) return;
    createDirectOrderFromEntry(button.dataset.directOrderEntry);
  });
  qs("#stock-entries-table").addEventListener("change", (event) => {
    const select = event.target.closest("[data-stock-entry-destination]");
    if (!select) return;
    updateStockEntryDestination(select.dataset.stockEntryDestination, select.value);
  });
  qs("#sefaz-import-btn")?.addEventListener("click", importSefazNotes);
  qs("#customer-form").addEventListener("submit", handleCustomerForm);
  qs("#customer-form").addEventListener("input", normalizeCustomerFormInput);
  qs("#lookup-customer-register-btn").addEventListener("click", lookupCustomerRegister);
  qs("#customer-register-document").addEventListener("blur", () => {
    const doc = cleanDocument(qs("#customer-register-document").value);
    if ([11, 14].includes(doc.length)) lookupCustomerRegister();
  });
  qs("#customer-register-document").addEventListener("input", debounce(() => {
    const doc = cleanDocument(qs("#customer-register-document").value);
    if ([11, 14].includes(doc.length)) lookupCustomerRegister();
  }));
  qs("#search-customers-btn").addEventListener("click", () => {
    activeCustomerSearch = qs("#customers-search").value.trim();
    renderCustomers();
  });
  const renderCustomersDebounced = debounce(() => {
    activeCustomerSearch = qs("#customers-search").value.trim();
    renderCustomers();
  }, 700);
  ["#customers-search", "#customers-city-filter"].forEach((selector) => {
    qs(selector).addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      activeCustomerSearch = qs("#customers-search").value.trim();
      renderCustomers();
    });
    qs(selector).addEventListener("input", renderCustomersDebounced);
  });
  qs("#customers-seller-filter").addEventListener("change", renderCustomers);
  qs("#clear-customers-search").addEventListener("click", () => {
    qs("#customers-search").value = "";
    qs("#customers-city-filter").value = "";
    qs("#customers-seller-filter").value = "";
    activeCustomerSearch = "";
    renderCustomers();
  });
  qs("#customers-import-file").addEventListener("change", importCustomersFile);
  qs("#clear-customers-btn").addEventListener("click", clearCustomers);
  qs("#cancel-edit-customer").addEventListener("click", () => {
    resetCustomerForm();
    showToast("Edicao de cliente cancelada.");
  });
  qs("#customers-table").addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-customer]");
    if (editButton) {
      startEditCustomer(editButton.dataset.editCustomer);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-customer]");
    if (deleteButton) deleteCustomer(deleteButton.dataset.deleteCustomer);
  });
  qs("#product-form").addEventListener("submit", handleProductForm);
  qs("#cancel-edit-product").addEventListener("click", () => {
    resetProductForm();
    showToast("Edicao de produto cancelada.");
  });
  qs("#products-table").addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) {
      startEditProduct(editButton.dataset.editProduct);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-product]");
    if (deleteButton) deleteProduct(deleteButton.dataset.deleteProduct);
  });
  qs("#sale-form").addEventListener("submit", handleSale);
  qs("#direct-load-items-table").addEventListener("input", updateDirectLoadItemTotals);
  qs("#enable-load-distribution").addEventListener("click", () => {
    const order = editingOrderId ? state.orders.find((item) => item.id === editingOrderId) : null;
    const entryId = sourceEntryForOrderId || order?.sourceEntryId || "";
    const entry = state.stockEntries.find((item) => item.id === entryId);
    if (!entry) {
      showToast("Nota vinculada nao encontrada.");
      return;
    }
    sourceEntryDistributionEnabled = true;
    showDirectLoadInfo(entry.invoice || "", entry.factoryOrder || "", entry);
    renderDirectLoadItems(currentDirectLoadEntries(entry));
    updateDirectLoadItemTotals();
    qs('[name="quantity"]').focus();
    showToast("Distribuição ativada. Informe a quantidade deste pedido.");
  });
  qs("#cancel-edit-order").addEventListener("click", () => {
    resetSaleForm();
    showToast("Edicao cancelada.");
  });
  qs("#orders-date-start-filter").addEventListener("input", renderOrders);
  qs("#orders-date-end-filter").addEventListener("input", renderOrders);
  qs("#orders-customer-filter").addEventListener("input", renderOrders);
  qs("#orders-finance-filter").addEventListener("change", renderOrders);
  qs("#clear-orders-filter").addEventListener("click", () => {
    linkedInvoiceOrderIds = [];
    linkedInvoiceEntryId = "";
    qs("#orders-date-start-filter").value = "";
    qs("#orders-date-end-filter").value = "";
    qs("#orders-customer-filter").value = "";
    qs("#orders-finance-filter").value = "";
    renderOrders();
  });
  qs("#config-orders-date-filter").addEventListener("input", renderConfigOrders);
  qs("#config-orders-number-filter").addEventListener("input", renderConfigOrders);
  qs("#clear-config-orders-filter").addEventListener("click", () => {
    qs("#config-orders-date-filter").value = today;
    qs("#config-orders-number-filter").value = "";
    renderConfigOrders();
  });
  qs("#config-orders-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-config-delete-order]");
    if (!button) return;
    const reasonInput = qs(`[data-order-delete-reason="${CSS.escape(button.dataset.configDeleteOrder)}"]`);
    deleteOrder(button.dataset.configDeleteOrder, reasonInput?.value || "");
  });
  qs("#logistics-date-filter").addEventListener("input", renderLogistics);
  qs("#logistics-stage-filter").addEventListener("change", renderLogistics);
  qs("#clear-logistics-filter").addEventListener("click", () => {
    qs("#logistics-date-filter").value = today;
    qs("#logistics-stage-filter").value = "";
    renderLogistics();
  });
  qs("#lookup-customer-btn").addEventListener("click", lookupCustomer);
  qs("#customer-search").addEventListener("input", debounce(() => {
    const value = qs("#customer-search").value.trim();
    renderCustomerOptions(value);
    updateDirectLoadDestinationMode();
  }));
  qs("#customer-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    lookupCustomer();
  });
  qs("#customer-search-results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-customer]");
    if (!button) return;
    const customer = findCustomerByTerm(button.dataset.selectCustomer);
    if (customer) {
      fillCustomer(customer);
      saveState();
      showToast("Cliente selecionado.");
    }
  });
  qs("#customer-document").addEventListener("blur", () => {
    qs("#customer-search").value = qs("#customer-document").value;
    lookupCustomer();
  });
  qs("#customer-document").addEventListener("input", debounce(() => {
    const value = cleanDocument(qs("#customer-document").value);
    applySaleSalesperson();
    updateDirectLoadDestinationMode();
    if (value.length === 11 || value.length === 14) {
      qs("#customer-search").value = qs("#customer-document").value;
      lookupCustomer();
    }
  }));
  qs("#customer-name").addEventListener("input", debounce(() => {
    applySaleSalesperson();
    applyCurrentPaymentRule();
    updateDirectLoadDestinationMode();
  }));
  qs("#customer-address").addEventListener("input", debounce(() => {
    applySaleSalesperson();
    applyCurrentPaymentRule();
    updateDirectLoadDestinationMode();
  }));
  qs("#sale-product").addEventListener("change", applyLastPrice);
  qs("#sale-form").addEventListener("input", updateSaleTotalPreview);
  qs("#sale-form").addEventListener("change", updateSaleTotalPreview);
  qs("#add-sale-item").addEventListener("click", () => addSaleExtraItem());
  qs("#sale-extra-items-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-sale-extra-item]");
    if (!button) return;
    syncSaleExtraItemDrafts();
    saleExtraItemDrafts = saleExtraItemDrafts.filter((item) => item.id !== button.dataset.removeSaleExtraItem);
    renderSaleExtraItems();
  });
  qs("#sale-extra-items-table").addEventListener("input", () => {
    syncSaleExtraItemDrafts();
    updateSaleTotalPreview();
  });
  qs("#sale-extra-items-table").addEventListener("change", () => {
    syncSaleExtraItemDrafts();
    updateSaleTotalPreview();
  });
  qs("#toggle-freight-return").addEventListener("click", () => {
    setSaleFreightType(qs("#sale-freight-type").value === "retorno" ? "entrega" : "retorno");
  });
  qs('[name="salesperson"]').addEventListener("change", applyCurrentPaymentRule);
  qs("#sale-stock-location").addEventListener("change", () => {
    renderSaleProductOptions();
    updateDirectLoadDestinationMode();
  });
  ["#customer-search", "#customer-document", "#customer-name"].forEach((selector) => {
    qs(selector)?.addEventListener("input", updateDirectLoadDestinationMode);
    qs(selector)?.addEventListener("change", updateDirectLoadDestinationMode);
  });
  qs("#orders-table").addEventListener("click", (event) => {
    const stageButton = event.target.closest("[data-stage-order]");
    if (stageButton) {
      updateOrderStage(stageButton.dataset.stageOrder, stageButton.dataset.stage);
      return;
    }
    const button = event.target.closest("[data-print-order]");
    if (button) {
      printOrder(button.dataset.printOrder, button.dataset.printCopy || "client");
      return;
    }
    const editButton = event.target.closest("[data-edit-order]");
    if (editButton) {
      startEditOrder(editButton.dataset.editOrder);
      return;
    }
  });
  qs("#invoice-destinations-summary").addEventListener("click", (event) => {
    const button = event.target.closest("[data-update-unit-destination]");
    if (!button) return;
    const [entryId, allocationId] = button.dataset.updateUnitDestination.split(":");
    const select = qs(`[data-unit-destination-select="${CSS.escape(`${entryId}:${allocationId}`)}"]`);
    updateInvoiceUnitDestination(entryId, allocationId, select?.value || "");
  });
  qs("#logistics-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-logistics-action]");
    if (!button) return;
    updateOrderStage(button.dataset.logisticsAction, button.dataset.stage);
  });
  qs("#logistics-table").addEventListener("change", (event) => {
    const stageSelect = event.target.closest("[data-logistics-stage]");
    if (stageSelect) {
      updateOrderStage(stageSelect.dataset.logisticsStage, stageSelect.value);
      return;
    }
    const field = event.target.closest("[data-logistics-field]");
    if (field) {
      updateOrderLogisticsField(field.dataset.logisticsField, field.dataset.field, field.value);
    }
  });
  qs("#receivables-table").addEventListener("click", (event) => {
    const orderButton = event.target.closest("[data-finance-order]");
    if (orderButton) {
      startEditOrder(orderButton.dataset.financeOrder);
      return;
    }
    const cancelButton = event.target.closest("[data-receivable-cancel]");
    if (cancelButton) {
      cancelReceivablePayment(cancelButton.dataset.receivableCancel);
      return;
    }
    const button = event.target.closest("[data-receivable-pay]");
    if (!button) return;
    const input = qs(`[data-partial-pay="${CSS.escape(button.dataset.receivablePay)}"]`);
    const paymentDate = qs(`[data-payment-date="${CSS.escape(button.dataset.receivablePay)}"]`)?.value || today;
    payReceivable(button.dataset.receivablePay, parseMoneyInput(input?.value || ""), paymentDate);
  });
  qs("#receivables-table").addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-partial-pay]");
    if (!input || event.key !== "Enter") return;
    event.preventDefault();
    const paymentDate = qs(`[data-payment-date="${CSS.escape(input.dataset.partialPay)}"]`)?.value || today;
    payReceivable(input.dataset.partialPay, parseMoneyInput(input.value || ""), paymentDate);
  });
  qs("#receivables-table").addEventListener("change", (event) => {
    const payment = event.target.closest("[data-receivable-payment]");
    if (payment) {
      updateReceivableField(payment.dataset.receivablePayment, "payment", payment.value);
      return;
    }
  });
  [
    "#finance-filter-client",
    "#finance-filter-order",
    "#finance-filter-due",
    "#finance-filter-value",
    "#finance-filter-seller",
    "#finance-filter-payment",
    "#finance-filter-status"
  ].forEach((selector) => {
    const field = qs(selector);
    field.addEventListener("input", () => {
      financeCurrentPage = 1;
      renderReceivables();
    });
    field.addEventListener("change", () => {
      financeCurrentPage = 1;
      renderReceivables();
    });
  });
  qs("#finance-prev-page")?.addEventListener("click", () => {
    if (financeCurrentPage > 1) {
      financeCurrentPage -= 1;
      renderReceivables();
    }
  });
  qs("#finance-next-page")?.addEventListener("click", () => {
    financeCurrentPage += 1;
    renderReceivables();
  });
  qs("#clear-finance-filter").addEventListener("click", () => {
    [
      "#finance-filter-client",
      "#finance-filter-order",
      "#finance-filter-due",
      "#finance-filter-value",
      "#finance-filter-seller",
      "#finance-filter-payment",
      "#finance-filter-status"
    ].forEach((selector) => {
      qs(selector).value = "";
    });
    financeCurrentPage = 1;
    renderReceivables();
  });
  qs("#omie-boletos-table").addEventListener("change", (event) => {
    const billing = event.target.closest("[data-omie-billing]");
    if (!billing) return;
    updateReceivableField(billing.dataset.omieBilling, "billingStatus", billing.value);
  });
  qsa("#omie-export-start, #omie-export-end, #omie-export-status, #omie-export-billing").forEach((field) => {
    field.addEventListener("input", renderBoletoExportSummary);
    field.addEventListener("change", renderBoletoExportSummary);
  });
  qs("#clear-omie-export-filter").addEventListener("click", () => {
    qs("#omie-export-start").value = "";
    qs("#omie-export-end").value = "";
    qs("#omie-export-status").value = "";
    qs("#omie-export-billing").value = "";
    renderBoletoExportSummary();
  });
  qs("#export-omie-boletos").addEventListener("click", exportBoletoOmieSpreadsheetLayout);
  qs("#sales-report-seller-filter").addEventListener("change", renderSalesReport);
  qs("#clear-sales-report-filter").addEventListener("click", () => {
    qs("#sales-report-seller-filter").value = "";
    renderSalesReport();
    renderWeightedAverageReport();
  });
  qs("#export-sales-report").addEventListener("click", exportSalesReportExcel);
  qs("#export-seller-report").addEventListener("click", exportSellerReportExcel);
  qs("#export-weighted-report").addEventListener("click", exportWeightedReportExcel);
  qsa("[data-report-tab-button]").forEach((button) => {
    button.addEventListener("click", () => showReportTab(button.dataset.reportTabButton));
  });
  ["#weighted-city-filter", "#weighted-product-filter", "#weighted-start-filter", "#weighted-end-filter"].forEach((selector) => {
    qs(selector).addEventListener("input", renderWeightedAverageReport);
    qs(selector).addEventListener("change", renderWeightedAverageReport);
  });
  qs("#clear-weighted-filter").addEventListener("click", () => {
    qs("#weighted-city-filter").value = "";
    qs("#weighted-product-filter").value = "";
    qs("#weighted-start-filter").value = "";
    qs("#weighted-end-filter").value = "";
    renderWeightedAverageReport();
  });
  ["#freight-date-start-filter", "#freight-date-end-filter", "#freight-driver-filter"].forEach((selector) => {
    qs(selector).addEventListener("input", renderFreights);
    qs(selector).addEventListener("change", renderFreights);
  });
  qs("#clear-freight-filter").addEventListener("click", () => {
    qs("#freight-date-start-filter").value = today;
    qs("#freight-date-end-filter").value = today;
    qs("#freight-driver-filter").value = "";
    renderFreights();
  });
  qs("#freight-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-freight-order]");
    if (!button) return;
    startEditOrder(button.dataset.freightOrder);
  });
  qsa("[data-freight-rate-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeFreightRateType = button.dataset.freightRateTab;
      renderFreightSettings();
    });
  });
  qs("#freight-rate-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (addFreightRate(qs("#freight-rate-city").value, qs("#freight-rate-value").value)) event.currentTarget.reset();
  });
  qs("#freight-rate-city-filter").addEventListener("input", renderFreightSettings);
  qs("#clear-freight-rate-filter").addEventListener("click", () => {
    qs("#freight-rate-city-filter").value = "";
    renderFreightSettings();
  });
  qs("#freight-rates-table").addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-freight-rate]");
    if (saveButton) {
      saveFreightRate(saveButton.dataset.saveFreightRate);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-freight-rate]");
    if (deleteButton) deleteFreightRate(deleteButton.dataset.deleteFreightRate);
  });
  qs("#new-sale-btn").addEventListener("click", () => qs('[data-view="pedidos"]').click());
  qs("#adjust-stock-btn").addEventListener("click", () => {
    renderStockAdjustmentOptions();
    qs("#manual-stock-panel").hidden = true;
    qs("#stock-adjustment-panel").hidden = !qs("#stock-adjustment-panel").hidden;
  });
  qs("#adjust-stock-origin").addEventListener("change", () => {
    const origin = qs("#adjust-stock-origin").value;
    const destination = qs("#adjust-stock-destination");
    if (destination.value === origin) destination.value = origin === "Divinopolis" ? "Arcos" : "Divinopolis";
  });
  qs("#adjust-stock-destination").addEventListener("change", () => {
    const destination = qs("#adjust-stock-destination").value;
    const origin = qs("#adjust-stock-origin");
    if (origin.value === destination) origin.value = destination === "Divinopolis" ? "Arcos" : "Divinopolis";
  });
  qs("#stock-adjustment-form").addEventListener("submit", handleStockAdjustment);
  qs("#cancel-stock-adjustment").addEventListener("click", () => {
    qs("#stock-adjustment-form").reset();
    qs("#stock-adjustment-panel").hidden = true;
  });
  qs("#add-stock-btn").addEventListener("click", () => {
    renderStockAdjustmentOptions();
    qs("#stock-adjustment-panel").hidden = true;
    const panel = qs("#manual-stock-panel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) qs("#manual-stock-date").value = qs("#manual-stock-date").value || today;
  });
  qs("#manual-stock-form").addEventListener("submit", handleManualStockMovement);
  qs("#cancel-manual-stock").addEventListener("click", () => {
    qs("#manual-stock-form").reset();
    qs("#manual-stock-date").value = today;
    qs("#manual-stock-panel").hidden = true;
  });
  qs("#load-sample-note")?.addEventListener("click", () => {
    importNote(sampleXml, {
      loadedBy: qs("#note-loader").value,
      factoryOrder: qs("#factory-order").value || "PED-FAB-9002",
      location: qs("#note-stock-location").value
    });
  });
  qs("#xml-file").addEventListener("change", async (event) => {
    await importXmlFiles(event.target.files);
    event.target.value = "";
  });
  qs("#notes-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-note]");
    if (!button) return;
    deleteImportedNote(button.dataset.deleteNote, button.dataset.deleteNoteNumber, button.dataset.deleteNoteSupplier);
  });
  qsa("[data-config-tab-button]").forEach((button) => {
    button.addEventListener("click", () => showConfigTab(button.dataset.configTabButton));
  });
  qsa("[data-client-tab-button]").forEach((button) => {
    button.addEventListener("click", () => showClientTab(button.dataset.clientTabButton));
  });
  qs("#users-settings-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-user]");
    if (!button) return;
  const user = users.find((item) => item.user === button.dataset.saveUser);
  if (!user) return;
  const nameInput = qs(`[data-config-name="${user.user}"]`);
  user.name = nameInput.value.trim() || user.user;
  saveUsersConfig();
  refreshCurrentUserLabel();
  showToast(`Acesso de ${user.name} salvo.`);
});
  qs("#user-permissions-table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-permissions]");
    if (!button) return;
    const user = users.find((item) => item.user === button.dataset.savePermissions);
    if (!user) return;
    user.permissions = defaultPermissions();
    permissionModules.forEach((module) => {
      const checkbox = qs(`[data-permission-user="${CSS.escape(user.user)}"][data-permission-view="${CSS.escape(module.id)}"]`);
      user.permissions[module.id] = Boolean(checkbox?.checked);
    });
    saveUsersConfig();
    refreshCurrentUserLabel();
    applyUserPermissions(getLoggedUser());
    showToast(`Permissoes de ${user.name} salvas.`);
  });
  const bindPaymentMethodForm = (formSelector, inputSelector) => {
    const form = qs(formSelector);
    const input = qs(inputSelector);
    if (!form || !input) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      addPaymentMethod(input.value);
      event.currentTarget.reset();
    });
  };
  const bindPaymentMethodTable = (selector) => {
    const table = qs(selector);
    if (!table) return;
    table.addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-payment]");
    if (saveButton) {
      const input = saveButton.closest("tr")?.querySelector("[data-payment-method]");
      savePaymentMethod(saveButton.dataset.savePayment, input.value);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-payment]");
    if (deleteButton) deletePaymentMethod(deleteButton.dataset.deletePayment);
    });
  };
  bindPaymentMethodForm("#payment-method-form", "#payment-method-name");
  bindPaymentMethodForm("#client-payment-method-form", "#client-payment-method-name");
  bindPaymentMethodForm("#finance-payment-method-form", "#finance-payment-method-name");
  bindPaymentMethodTable("#payment-methods-table");
  bindPaymentMethodTable("#client-payment-methods-table");
  bindPaymentMethodTable("#finance-payment-methods-table");
  const bindPaymentTermForm = (formSelector, inputSelector) => {
    const form = qs(formSelector);
    const input = qs(inputSelector);
    if (!form || !input) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      addPaymentTerm(input.value);
      event.currentTarget.reset();
    });
  };
  const bindPaymentTermTable = (selector) => {
    const table = qs(selector);
    if (!table) return;
    table.addEventListener("click", (event) => {
      const saveButton = event.target.closest("[data-save-term]");
      if (saveButton) {
        const input = saveButton.closest("tr")?.querySelector("[data-payment-term]");
        savePaymentTerm(saveButton.dataset.saveTerm, input.value);
        return;
      }
      const deleteButton = event.target.closest("[data-delete-term]");
      if (deleteButton) deletePaymentTerm(deleteButton.dataset.deleteTerm);
    });
  };
  bindPaymentTermForm("#payment-term-form", "#payment-term-name");
  bindPaymentTermForm("#client-payment-term-form", "#client-payment-term-name");
  bindPaymentTermForm("#finance-payment-term-form", "#finance-payment-term-name");
  bindPaymentTermTable("#payment-terms-table");
  bindPaymentTermTable("#client-payment-terms-table");
  bindPaymentTermTable("#finance-payment-terms-table");
  qs("#payment-rule-type").addEventListener("change", renderPaymentRuleReferenceOptions);
  qs("#payment-rule-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const referenceInput = qs("#payment-rule-reference");
    addPaymentRule(
      qs("#payment-rule-type").value,
      referenceInput.value,
      qs("#payment-rule-method").value,
      qs("#payment-rule-term").value
    );
  });
  qs("#payment-rules-table").addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-payment-rule]");
    if (deleteButton) deletePaymentRule(deleteButton.dataset.deletePaymentRule);
  });
  qs("#salesperson-form").addEventListener("submit", (event) => {
    event.preventDefault();
    addSalesperson(qs("#salesperson-name").value);
    event.currentTarget.reset();
  });
  qs("#salespeople-table").addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-salesperson]");
    if (saveButton) {
      const input = qs(`[data-salesperson="${CSS.escape(saveButton.dataset.saveSalesperson)}"]`);
      saveSalesperson(saveButton.dataset.saveSalesperson, input.value);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-salesperson]");
    if (deleteButton) deleteSalesperson(deleteButton.dataset.deleteSalesperson);
  });
  qs("#driver-form").addEventListener("submit", (event) => {
    event.preventDefault();
    addDriver(qs("#driver-name").value);
    event.currentTarget.reset();
  });
  qs("#drivers-table").addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-driver]");
    if (saveButton) {
      const input = qs(`[data-driver="${CSS.escape(saveButton.dataset.saveDriver)}"]`);
      saveDriver(saveButton.dataset.saveDriver, input.value);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-driver]");
    if (deleteButton) deleteDriver(deleteButton.dataset.deleteDriver);
  });
  qs("#seller-city-form").addEventListener("submit", (event) => {
    event.preventDefault();
    addSellerCity(
      qs("#seller-city-name").value,
      qs("#seller-city-uf").value,
      qs("#seller-city-salesperson").value
    );
    event.currentTarget.reset();
    renderSellerCitiesSettings();
  });
  qs("#seller-city-filter").addEventListener("change", renderSellerCitiesSettings);
  qs("#clear-seller-city-filter").addEventListener("click", () => {
    qs("#seller-city-filter").value = "";
    renderSellerCitiesSettings();
  });
  qs("#seller-cities-table").addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-seller-city]");
    if (saveButton) {
      saveSellerCity(saveButton.dataset.saveSellerCity);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-seller-city]");
    if (deleteButton) deleteSellerCity(deleteButton.dataset.deleteSellerCity);
  });
  qs("#financial-account-form").addEventListener("submit", (event) => {
    event.preventDefault();
    addFinancialAccount(qs("#financial-account-name").value);
    event.currentTarget.reset();
  });
  qs("#accounts-settings-table").addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-account]");
    if (saveButton) {
      const input = qs(`[data-account-name="${CSS.escape(saveButton.dataset.saveAccount)}"]`);
      saveFinancialAccount(saveButton.dataset.saveAccount, input.value);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-account]");
    if (deleteButton) deleteFinancialAccount(deleteButton.dataset.deleteAccount);
  });
}

function initializeOrderDateFilters() {
  refreshToday();
  const startInput = qs("#orders-date-start-filter");
  const endInput = qs("#orders-date-end-filter");
  if (startInput && !startInput.value) startInput.value = today;
  if (endInput && !endInput.value) endInput.value = today;
}

async function bootSystem() {
  try {
    await initFirebaseAppOnly();
    renderNavigation();
    initLogin();
  } catch (error) {
    console.error("Erro ao abrir tela inicial:", error);
    document.body.classList.remove("login-active");
  }
}

bootSystem();

try {
  bindEvents();
  initializeOrderDateFilters();
} catch (error) {
  console.error("Erro ao ativar botoes:", error);
  showToast("Sistema aberto. Alguns botoes precisam ser revisados.");
}

try {
  migrateExistingBoletoReceipts();
  normalizeDirectLoadDeliveries();
  migrateLegacyEntryAllocations();
  repairPendingOrderStockPostings();
  if (removeLegacyDivinopolisEdmilsonAssignments()) saveState();
  renderAll();
} catch (error) {
  console.error("Erro ao carregar dados locais:", error);
  showToast("Sistema aberto. Algum lançamento local precisa ser revisado.");
}
