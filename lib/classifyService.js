// Inlined keyword configuration (moved from config/serviceKeywords.js)
// Each key: slugified service name -> { positive: [tokens], minScore, serviceIds? (populated dynamically) }
const keywordsConfig = {
  'cham_soc_nguoi_cao_tuoi': {
    positive: [
      'cham soc nguoi cao tuoi','nguoi cao tuoi','elderly care','elderly','cham soc','cham soc nguoi gia','nguoi gia'
    ],
    minScore: 0.25
  },
  // Canonical merged slug for elderly + patient care service (DB likely uses a longer name)
  'cham_soc_nguoi_gia_va_benh_nhan': {
    positive: [
      'cham soc nguoi gia va benh nhan','cham soc benh nhan','nguoi gia va benh nhan','nguoi gia','nguoi cao tuoi','benh nhan','elderly care','elderly patient care','patient care','elderly','old people care','cham soc nguoi cao tuoi','cham soc','cham soc benh nhan tai nha'
    ],
    minScore: 0.25
  },
  'cham_soc_me_va_be': {
    positive: [
      'cham soc me va be','me va be','mother and baby care','mother and baby','mother baby','sau sinh','cham soc me','cham soc tre'
    ],
    minScore: 0.25
  },
  'sua_chua_dieu_hoa': {
    positive: [
      'dieu hoa','may lanh','air conditioner','airconditioner','hvac','bao tri dieu hoa','sua dieu hoa'
    ],
    minScore: 0.3
  },
  've_sinh_nha_cua': {
    positive: [
      've sinh','ve sinh nha','don dep','don nha','nha cua sach','cleaning','house cleaning','lau don'
    ],
    minScore: 0.3
  },
  'nau_an': {
  positive: [
    // Từ khóa tiếng Việt
    'nấu ăn', 'dạy nấu ăn', 'lớp học nấu ăn', 'khóa học nấu ăn', 'học nấu ăn',
    'đầu bếp', 'bếp trưởng', 'nghề bếp', 'học nghề bếp',
    'chứng chỉ nấu ăn', 'chứng chỉ đầu bếp', 'chứng chỉ nghề bếp', 'bằng nấu ăn',
    'món ăn', 'ẩm thực', 'nấu món', 'học làm món ăn', 'làm món ăn', 'món ngon',
    'dạy làm bánh', 'khóa học làm bánh', 'lớp học làm bánh', 'bằng làm bánh',

    // Từ khóa tiếng Anh
    'cooking', 'cook', 'chef', 'culinary', 'culinary certificate', 
    'cooking course', 'cooking class', 'learn to cook', 'cooking skill',
    'food preparation', 'recipe', 'dish', 'cuisine', 'baking', 'pastry'
  ],
  minScore: 0.25
},

};

function slugify(str){
  return (str||'').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}
function normalize(str){
  return (str||'').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,' ').trim();
}

function classifyService({ services = [], text }) {
  const normText = normalize(text);
  const results = [];
  const serviceMap = new Map();
  services.forEach(s=>{
    const slug = slugify(s.name);
    serviceMap.set(slug, s);
    if(!keywordsConfig[slug]){
      // derive basic tokens from name (>=3 chars)
      const baseTokens = slug.split('_').filter(t=>t.length>=3);
      keywordsConfig[slug] = { positive: baseTokens, minScore: 0.3, serviceIds:[s.service_id] };
    } else {
      if(!keywordsConfig[slug].serviceIds) keywordsConfig[slug].serviceIds=[s.service_id];
      else if(!keywordsConfig[slug].serviceIds.includes(s.service_id)) keywordsConfig[slug].serviceIds.push(s.service_id);
    }
  });

  for (const [slug, cfg] of Object.entries(keywordsConfig)) {
    const positives = (cfg.positive||[]).map(normalize).filter(Boolean);
    if(!positives.length) continue;
    let matched = 0;
    const matchedTokens = [];
    for(const token of positives){
      if(normText.includes(token)) { matched++; matchedTokens.push(token); }
    }
    const score = matched / positives.length;
    results.push({ slug, score, matched, total: positives.length, matchedTokens, minScore: cfg.minScore||0.3, serviceIds: cfg.serviceIds||[] });
  }
  results.sort((a,b)=> b.score - a.score);
  const best = results[0];
  if(!best || best.score < best.minScore) return { detected: null, results };
  // Alias mapping: unify elderly care slugs to canonical service slug if available among DB services
  const aliasMap = {
    'cham_soc_nguoi_cao_tuoi': 'cham_soc_nguoi_gia_va_benh_nhan'
  };
  let finalBest = best;
  if(aliasMap[best.slug] && serviceMap.has(aliasMap[best.slug])) {
    // If canonical slug exists among services, promote its serviceIds / slug
    const targetSlug = aliasMap[best.slug];
    // Ensure canonical config collects serviceIds
    if(keywordsConfig[targetSlug]) {
      if(!keywordsConfig[targetSlug].serviceIds) {
        // Populate from matching services list
        const svc = serviceMap.get(targetSlug);
        if (svc) keywordsConfig[targetSlug].serviceIds = [svc.service_id];
      }
    }
    finalBest = { ...best, slug: targetSlug, serviceIds: (keywordsConfig[targetSlug] && keywordsConfig[targetSlug].serviceIds) || best.serviceIds };
  }
  return { detected: finalBest, results };
}

module.exports = { classifyService, slugify, normalize };
