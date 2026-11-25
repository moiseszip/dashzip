/**
 * País e estado das vendas, para os cards Vendas por país e Vendas por estado
 * (docs/features/24-summary/summary.md). Os checkouts mandam o país em ISO-2
 * (Wiapy, Kiwify…), ISO-3 ("BRA"), nome ("Brasil", "Portugal" na Hotmart
 * internacional) ou um marcador ("OTHER" na Ticto). Tudo vira ISO-2; o que não
 * for reconhecido conta como "sem país".
 */

/** ISO 3166-1: alfa-2, alfa-3 e numérico (o numérico é o id do país no world-atlas). */
const ISO_TABLE = [
  'AFAFG004 ALALB008 DZDZA012 ASASM016 ADAND020 AOAGO024 AIAIA660 AQATA010 AGATG028 ARARG032 AMARM051 AWABW533',
  'AUAUS036 ATAUT040 AZAZE031 BSBHS044 BHBHR048 BDBGD050 BBBRB052 BYBLR112 BEBEL056 BZBLZ084 BJBEN204 BMBMU060',
  'BTBTN064 BOBOL068 BABIH070 BWBWA072 BVBVT074 BRBRA076 IOIOT086 BNBRN096 BGBGR100 BFBFA854 BIBDI108 KHKHM116',
  'CMCMR120 CACAN124 CVCPV132 KYCYM136 CFCAF140 TDTCD148 CLCHL152 CNCHN156 CXCXR162 CCCCK166 COCOL170 KMCOM174',
  'CGCOG178 CDCOD180 CKCOK184 CRCRI188 CICIV384 HRHRV191 CUCUB192 CYCYP196 CZCZE203 DKDNK208 DJDJI262 DMDMA212',
  'DODOM214 ECECU218 EGEGY818 SVSLV222 GQGNQ226 ERERI232 EEEST233 ETETH231 FKFLK238 FOFRO234 FJFJI242 FIFIN246',
  'FRFRA250 GFGUF254 PFPYF258 TFATF260 GAGAB266 GMGMB270 GEGEO268 DEDEU276 GHGHA288 GIGIB292 GRGRC300 GLGRL304',
  'GDGRD308 GPGLP312 GUGUM316 GTGTM320 GNGIN324 GWGNB624 GYGUY328 HTHTI332 HMHMD334 VAVAT336 HNHND340 HKHKG344',
  'HUHUN348 ISISL352 ININD356 IDIDN360 IRIRN364 IQIRQ368 IEIRL372 ILISR376 ITITA380 JMJAM388 JPJPN392 JOJOR400',
  'KZKAZ398 KEKEN404 KIKIR296 KPPRK408 KRKOR410 KWKWT414 KGKGZ417 LALAO418 LVLVA428 LBLBN422 LSLSO426 LRLBR430',
  'LYLBY434 LILIE438 LTLTU440 LULUX442 MOMAC446 MGMDG450 MWMWI454 MYMYS458 MVMDV462 MLMLI466 MTMLT470 MHMHL584',
  'MQMTQ474 MRMRT478 MUMUS480 YTMYT175 MXMEX484 FMFSM583 MDMDA498 MCMCO492 MNMNG496 MSMSR500 MAMAR504 MZMOZ508',
  'MMMMR104 NANAM516 NRNRU520 NPNPL524 NLNLD528 NCNCL540 NZNZL554 NINIC558 NENER562 NGNGA566 NUNIU570 NFNFK574',
  'MPMNP580 MKMKD807 NONOR578 OMOMN512 PKPAK586 PWPLW585 PSPSE275 PAPAN591 PGPNG598 PYPRY600 PEPER604 PHPHL608',
  'PNPCN612 PLPOL616 PTPRT620 PRPRI630 QAQAT634 REREU638 ROROU642 RURUS643 RWRWA646 SHSHN654 KNKNA659 LCLCA662',
  'PMSPM666 VCVCT670 WSWSM882 SMSMR674 STSTP678 SASAU682 SNSEN686 SCSYC690 SLSLE694 SGSGP702 SKSVK703 SISVN705',
  'SBSLB090 SOSOM706 ZAZAF710 GSSGS239 ESESP724 LKLKA144 SDSDN729 SRSUR740 SJSJM744 SZSWZ748 SESWE752 CHCHE756',
  'SYSYR760 TWTWN158 TJTJK762 TZTZA834 THTHA764 TLTLS626 TGTGO768 TKTKL772 TOTON776 TTTTO780 TNTUN788 TRTUR792',
  'TMTKM795 TCTCA796 TVTUV798 UGUGA800 UAUKR804 AEARE784 GBGBR826 USUSA840 UMUMI581 UYURY858 UZUZB860 VUVUT548',
  'VEVEN862 VNVNM704 VGVGB092 VIVIR850 WFWLF876 EHESH732 YEYEM887 ZMZMB894 ZWZWE716 AXALA248 BQBES535 CWCUW531',
  'GGGGY831 IMIMN833 JEJEY832 MEMNE499 BLBLM652 MFMAF663 RSSRB688 SXSXM534 SSSSD728 XKXKK983',
].join(' ');

export interface CountryCode { iso2: string; iso3: string; numeric: string }

const BY_ISO2 = new Map<string, CountryCode>();
const BY_ISO3 = new Map<string, CountryCode>();
for (const entry of ISO_TABLE.split(' ')) {
  const code = { iso2: entry.slice(0, 2), iso3: entry.slice(2, 5), numeric: entry.slice(5, 8) };
  BY_ISO2.set(code.iso2, code);
  BY_ISO3.set(code.iso3, code);
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

function displayNames(locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    return null;
  }
}

/** Nomes em português, inglês e espanhol (Intl) e apelidos comuns, sem acento e sem espaço. */
const BY_NAME = (() => {
  const map = new Map<string, string>();
  for (const locale of ['es', 'en', 'pt-PT', 'pt-BR']) {
    const names = displayNames(locale);
    if (!names) continue;
    for (const iso2 of BY_ISO2.keys()) {
      const name = names.of(iso2);
      if (name && name !== iso2) map.set(fold(name), iso2);
    }
  }
  const aliases: Record<string, string> = {
    usa: 'US', eua: 'US', unitedstatesofamerica: 'US', estadosunidosdaamerica: 'US', uk: 'GB', inglaterra: 'GB',
    england: 'GB', greatbritain: 'GB', holanda: 'NL', holland: 'NL', russia: 'RU', coreiadosul: 'KR', southkorea: 'KR',
  };
  for (const [name, iso2] of Object.entries(aliases)) map.set(name, iso2);
  return map;
})();

const PT_NAMES = displayNames('pt-BR');

/** País da venda em ISO-2 maiúsculo, ou null quando vazio ou desconhecido. */
export function normalizeCountry(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.length === 2 && BY_ISO2.has(upper)) return upper;
  if (upper.length === 3 && BY_ISO3.has(upper)) return BY_ISO3.get(upper)!.iso2;
  return BY_NAME.get(fold(raw)) ?? null;
}

export function countryCode(iso2: string): CountryCode | null {
  return BY_ISO2.get(iso2) ?? null;
}

/** Nome do país em português ("BR" → "Brasil"). */
export function countryName(iso2: string) {
  return PT_NAMES?.of(iso2) ?? iso2;
}

/** As 27 unidades da federação. */
export const BRAZIL_STATES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
  SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

const STATE_BY_NAME = new Map(Object.entries(BRAZIL_STATES).map(([uf, name]) => [fold(name), uf]));

/** UF da venda ("sp", "São Paulo", "BR-SP" → "SP"), ou null. */
export function normalizeState(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/^BR-/, '');
  if (upper.length === 2 && BRAZIL_STATES[upper]) return upper;
  return STATE_BY_NAME.get(fold(raw)) ?? null;
}
