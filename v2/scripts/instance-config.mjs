export function validateRegistry(value) {
  if(!value || value.schemaVersion!==1 || !Array.isArray(value.instances) || !value.instances.length || value.instances.length>1000) throw Error('Invalid private instance registry.');
  const seen={id:new Set(),workerName:new Set(),databaseName:new Set(),databaseId:new Set(),origin:new Set()};
  return value.instances.map(raw=>{
    if(!raw || typeof raw!=='object') throw Error('Invalid instance record.');
    for(const key of ['id','workerName','databaseName']) {
      if(typeof raw[key]!=='string' || !/^[a-z][a-z0-9-]{2,62}$/.test(raw[key])) throw Error('Instance and resource names must use lowercase letters, numbers and hyphens.');
    }
    if(typeof raw.databaseId!=='string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.databaseId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(raw.databaseId)) throw Error('A real D1 database UUID is required.');
    let url;try {url=new URL(raw.origin);} catch {throw Error('An HTTPS instance origin is required.');}
    if(url.protocol!=='https:' || url.origin!==raw.origin || url.username || url.password) throw Error('Origin must be a canonical HTTPS origin without a path, query or credentials.');
    const entry={id:raw.id,workerName:raw.workerName,databaseName:raw.databaseName,databaseId:raw.databaseId.toLowerCase(),origin:raw.origin};
    for(const key of Object.keys(seen)) {
      if(seen[key].has(entry[key])) throw Error('Duplicate instance, resource, database or origin in private registry.');
      seen[key].add(entry[key]);
    }
    return entry;
  });
}
export function instanceConfig(template,entry,sourcePrefix='../..') {
  return {...structuredClone(template),name:entry.workerName,preview_urls:false,
    main:sourcePrefix+'/worker/index.ts',
    vars:{INSTANCE_ID:entry.id,INSTANCE_ORIGIN:entry.origin},
    d1_databases:[{binding:'DB',database_id:entry.databaseId,database_name:entry.databaseName,migrations_dir:sourcePrefix+'/migrations'}],
    assets:{...template.assets,directory:sourcePrefix+'/dist'},
  };
}
