

const affiliations_to_country_map = {
    "Adobe": "U.S.A.",
    "Arizona State University": "U.S.A.",
    "Beihang University": "Greater China",
    "Beijing Academy of Artificial Intelligence (BAAI)": "Greater China",
    "Beijing Institute of Technology": "Greater China",
    "Beijing University of Posts and Telecommunications": "Greater China",
    "Carnegie Mellon University": "U.S.A.",
    "Case Western reserve University": "U.S.A.",
    "Chinese Academy of Sciences": "Greater China",
    "Chinese University of Hong Kong": "Greater China",
    "Cornell University": "U.S.A.",
    "DKFZ": "Germany",
    "East China Normal University": "Greater China",
    "Fraunhofer Institute for Digital Medicine MEVIS": "Germany",
    "Fudan University": "Greater China",
    "Google": "U.S.A.",
    "Harbin Institute of Technology (Shenzhen)": "Greater China",
    "Harvard University": "U.S.A.",
    "Huawei Technologies": "Greater China",
    "Imperial College London": "U.K.",
    "Johns Hopkins University": "U.S.A.",
    "Lehigh University": "U.S.A.",
    "Ludwig-Maximilians-Universit\u00e4t M\u00fcnchen": "Germany",
    "Meta": "U.S.A.",
    "MIT": "U.S.A.",
    "Medical College of Tianjin University": "Greater China",
    "Memorial Sloan Kettering Cancer Center": "U.S.A.",
    "Microsoft": "U.S.A.",
    "Mohamed bin Zayed University of Artificial Intelligence": "U.A.E.",
    "Nvidia": "U.S.A.",
    "Nanjing University of Science and Technology": "Greater China",
    "National University of Singapore": "Singapore",
    "Northwestern Polytechnical University Xi'an": "Greater China",
    "Peking University": "Greater China",
    "Princeton": "U.S.A.",
    "RWTH Aachen University": "Germany",
    "Ritsumeikan University": "Japan",
    "Rutgers University": "U.S.A.",
    "Shanghai AI Laboratory": "Greater China",
    "Shanghai Jiao Tong University": "Greater China",
    "Sichuan University": "Greater China",
    "Southeast University": "Greater China",
    "Stanford University": "U.S.A.",
    "Technical University of Munich": "Germany",
    "Technische Universitat Munchen": "Germany",
    "Tencent YouTu X-Lab": "Greater China",
    "The Hong Kong Polytechnic University": "Greater China",
    "The Hong Kong University of Science and Technology": "Greater China",
    "The University of Adelaide": "Australia",
    "University Hospital Basel": "Switzerland",
    "University of California": "U.S.A.",
    "University of Cambridge": "U.K.",
    "University of Electronic Science and Technology of China": "Greater China",
    "University of Florida": "U.S.A.",
    "University of Freiburg": "Germany",
    "University of Hong Kong": "Greater China",
    "University of Illinois Urbana-Champaign": "U.S.A.",
    "University of Oxford": "U.K.",
    "University of Regensburg": "Germany",
    "University of Rennes": "France",
    "University of Science and Technology Beijing": "Greater China",
    "University of Science and Technology of China": "Greater China",
    "University of Toronto": "Canada",
    "University of Wisconsin-Madison": "U.S.A.",
    "Vanderbilt University": "U.S.A.",
    "Vector Institute for Artificial Intelligence": "Canada",
    "West Virginia University": "U.S.A.",
    "Zhejiang Shuren University": "Greater China",
    "Zhejiang University": "Greater China",
}

export var country_to_list_of_affiliations_map = {}
for (const [key, value] of Object.entries(affiliations_to_country_map)) {
    if (!country_to_list_of_affiliations_map[value]) {
        country_to_list_of_affiliations_map[value] = [];
    }
    country_to_list_of_affiliations_map[value].push(key);
}

const country_to_flag_src_map = {
    "U.S.A.": "https://flagcdn.com/us.svg",
    "U.K.": "https://flagcdn.com/gb.svg",
    "Germany": "https://flagcdn.com/de.svg",
    "France": "https://flagcdn.com/fr.svg",
    "Japan": "https://flagcdn.com/jp.svg",
    "Canada": "https://flagcdn.com/ca.svg",
    "Australia": "https://flagcdn.com/au.svg",
    "Switzerland": "https://flagcdn.com/ch.svg",
    "Singapore": "https://flagcdn.com/sg.svg",
    "U.A.E.": "https://flagcdn.com/ae.svg",
    "Greater China": "https://flagcdn.com/cn.svg",
}


/**
 * 
 * @param {Array} affiliations A list of affiliations present in affilations_to_country_map 
 */
export function getSetOfCountriesFromAffiliations(affiliations) {
    const countries = new Set();
    affiliations.forEach(affiliation => {
        if (affiliations_to_country_map[affiliation]) {
            countries.add(affiliations_to_country_map[affiliation]);
        } else {
            console.error(`Affiliation "${affiliation}" not found in affiliations_to_country_map.`);
        }
    });
    return Array.from(countries);
}