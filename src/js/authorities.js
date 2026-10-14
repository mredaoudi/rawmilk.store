// Food safety authority for each country, with the page to link to in each
// site language. Every URL was checked on 2026-10-13. The link text lives in
// the locale files, under "authorities".
//
// France and Germany have no single national office for this: checks are done
// by the departmental DDPP and by the food control offices of the Länder, so
// the links go to the official directory or overview page.

const BVL =
  'https://www.bvl.bund.de/DE/Arbeitsbereiche/01_Lebensmittel/01_Aufgaben/01_WerMachtWas/01_Landesbehoerden/lm_vet_ueberw_node.html';
const DDPP = 'https://lannuaire.service-public.gouv.fr/navigation/ddpp';

export const AUTHORITY_URLS = {
  BE: {
    fr: 'https://favv-afsca.be/fr',
    nl: 'https://favv-afsca.be/nl',
    de: 'https://favv-afsca.be/de',
    en: 'https://www.fasfc.be/',
  },
  NL: {
    fr: 'https://www.nvwa.nl/',
    nl: 'https://www.nvwa.nl/',
    de: 'https://www.nvwa.nl/',
    en: 'https://english.nvwa.nl/',
  },
  LU: {
    fr: 'https://ma.gouvernement.lu/fr/administrations/alva.html',
    nl: 'https://ma.gouvernement.lu/en/administrations/alva.html',
    de: 'https://ma.gouvernement.lu/de/administrations/alva.html',
    en: 'https://ma.gouvernement.lu/en/administrations/alva.html',
  },
  DE: { fr: BVL, nl: BVL, de: BVL, en: BVL },
  FR: { fr: DDPP, nl: DDPP, de: DDPP, en: DDPP },
};

export const DATA_PORTAL_URL =
  'https://agridata.ec.europa.eu/extensions/DashboardRawMilk/RawMilkPrices.html';
