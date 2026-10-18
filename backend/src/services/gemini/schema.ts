import {AppError} from '../../runtime/errors.js';
import {Contracts,object,type Data} from '../validation.js';

// Project the authoritative draft-07 schema into model-facing JSON Schema.
// Runtime validation still uses the untouched shared schema; no remote refs are fetched.
export function modelParameters(contracts: Contracts,name: string): Data {
  const root=contracts.schemas[name];
  if (!root) throw new AppError('CONTRACTS_UNAVAILABLE',`Shared schema ${name} has not been supplied`,503,true);
  const aliases=new Map<string,unknown>(Object.entries(contracts.schemas));
  for (const value of Object.values(contracts.schemas)) if (value && typeof value==='object' && typeof value.$id==='string') aliases.set(value.$id,value);
  const invalid=()=>new AppError('MODEL_SCHEMA_UNSUPPORTED','Tool schema has an unresolved, recursive or oversized local reference',503);
  let visited=0;
  function walk(value: unknown,base: unknown,stack: Set<unknown>,depth=0): unknown {
    if (++visited>4000 || depth>32) throw invalid();
    if (typeof value==='boolean') return value;
    const schema=object(value);
    if (stack.has(value)) throw invalid();
    const next=new Set(stack).add(value);
    if (typeof schema.$ref==='string') {
      const [id,fragment]=schema.$ref.split('#');
      const baseId=base && typeof base==='object' && '$id' in base?base.$id:undefined;
      const resolvedId=id && typeof baseId==='string'?new URL(id,baseId).href:id;
      const referencedBase=id?aliases.get(resolvedId!) ?? aliases.get(id):base;
      let target=referencedBase;
      if (fragment) {
        if (!fragment.startsWith('/')) throw invalid();
        for (const encoded of fragment.slice(1).split('/')) {
          const key=decodeURIComponent(encoded).replaceAll('~1','/').replaceAll('~0','~');
          if (!target || typeof target!=='object' || !Object.hasOwn(target,key)) throw invalid();
          target=(target as Data)[key];
        }
      }
      if (target===undefined) throw invalid();
      return walk(target,referencedBase,next,depth+1);
    }
    const projected: Data={};
    for (const [key,item] of Object.entries(schema)) {
      // Gemini's grammar compiler can reject cumulative array maxima in rich
      // tool declarations. They are model hints only; the untouched authoritative
      // schema still enforces every array bound before dispatch/finalization.
      if (['$schema','$id','$defs','definitions','$comment','additionalItems'].includes(key) || (key==='maxItems' && item!==0)) continue;
      if (['properties','patternProperties','dependentSchemas'].includes(key)) projected[key]=Object.fromEntries(Object.entries(object(item)).map(([property,child])=>[property,walk(child,base,next,depth+1)]));
      else if (['anyOf','oneOf','allOf'].includes(key) && Array.isArray(item)) projected[key]=item.map(child=>walk(child,base,next,depth+1));
      else if (key==='items' && Array.isArray(item)) {
        projected.prefixItems=item.map(child=>walk(child,base,next,depth+1));
        if (schema.additionalItems!==undefined) projected.items=walk(schema.additionalItems,base,next,depth+1);
      } else if (['items','additionalProperties','not','contains','if','then','else','propertyNames'].includes(key)) projected[key]=walk(item,base,next,depth+1);
      else if (key==='const') projected.enum=[item];
      else projected[key]=structuredClone(item);
    }
    return projected;
  }
  return object(walk(root,root,new Set()));
}

// Provider hints use Gemini's JSON Schema subset. The original contract still
// validates every tool argument and final draft before anything is dispatched.
// Apply this at the request boundary, after v2 has restricted its action union.
export function geminiJsonSchema(value: unknown): Data {
  function walk(value: unknown): unknown {
    if (typeof value==='boolean') return value;
    const schema=object(value), projected: Data={};
    for (const key of ['type','title','description','enum','format','minimum','maximum','minItems','maxItems','propertyOrdering'])
      if (schema[key]!==undefined) projected[key]=structuredClone(schema[key]);
    if (!projected.type && Array.isArray(schema.enum)) {
      const types=[...new Set(schema.enum.map(item=>item===null?'null':typeof item))];
      if (types.every(type=>['string','number','boolean','null'].includes(type))) projected.type=types.length===1?types[0]:types;
    }
    if (schema.properties) projected.properties=Object.fromEntries(Object.entries(object(schema.properties)).map(([name,child])=>[name,walk(child)]));
    if (schema.required) projected.required=structuredClone(schema.required);
    if (schema.additionalProperties!==undefined) projected.additionalProperties=walk(schema.additionalProperties);
    if (schema.maxItems===0) {
      // No element can occur: do not ask the grammar compiler to expand a large
      // action union for the final draft's necessarily empty actions array.
      projected.items={type:'null'};
    } else {
      if (schema.items!==undefined) projected.items=walk(schema.items);
      if (Array.isArray(schema.prefixItems)) projected.prefixItems=schema.prefixItems.map(walk);
    }
    const alternatives=schema.anyOf ?? schema.oneOf;
    if (Array.isArray(alternatives)) projected.anyOf=alternatives.map(walk);
    return projected;
  }
  return object(walk(value));
}
