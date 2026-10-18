import { expect, it, vi } from 'vitest';
import { createHttpApi, parseRetryAfter } from '../src/lib/api';
import { globalSample, INITIAL_TIME, sample } from './flight-samples';

it('parses Retry-After seconds and HTTP dates without accepting malformed numbers/dates', () => {
  expect(parseRetryAfter('120', INITIAL_TIME)).toBe(INITIAL_TIME+120_000);
  expect(parseRetryAfter('Sat, 17 Oct 2026 12:02:00 GMT',INITIAL_TIME)).toBe(INITIAL_TIME+120_000);
  expect(parseRetryAfter('Sat, 17 Oct 2026 11:00:00 GMT',INITIAL_TIME)).toBe(INITIAL_TIME);
  for(const input of [null,'','-1','garbage','1e4']) expect(parseRetryAfter(input,INITIAL_TIME)).toBeNull();
});
it('uses only the area endpoint and rejects responses outside the shared schema',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(sample()))).mockResolvedValueOnce(new Response(JSON.stringify({...sample(),status:'invented'})));
  const api=createHttpApi(fetcher),signal=new AbortController().signal;
  await expect(api.flightArea!({latitude:43.7,longitude:-79.4,radius_nm:100},signal)).resolves.toEqual(sample());
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/flights/area?latitude=43.7&longitude=-79.4&radius_nm=100');
  await expect(api.flightArea!({latitude:43.7,longitude:-79.4,radius_nm:100},signal)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  expect(() => api.flightArea!({latitude:91,longitude:0,radius_nm:100},signal)).toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('preserves structured error envelopes and HTTP retry timing',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({error:{code:'FLIGHT_REGION_CAPACITY',message:'Busy',retryable:true,request_id:'test-request'}}),{status:429,headers:{'Retry-After':'120'}}));
  const now=Date.now();
  await expect(createHttpApi(fetcher).flightArea!({latitude:0,longitude:0,radius_nm:100},new AbortController().signal)).rejects.toMatchObject({code:'FLIGHT_REGION_CAPACITY',status:429,retryable:true,requestId:'test-request',retryAt:expect.any(Number)});
  try{await createHttpApi(fetcher).flightArea!({latitude:0,longitude:0,radius_nm:100},new AbortController().signal);}catch(error){expect((error as {retryAt:number}).retryAt).toBeGreaterThanOrEqual(now+120_000);}
});
it('honors HTTP backoff even for a non-JSON proxy error', async () => {
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('Service unavailable',{status:503,headers:{'Retry-After':'120'}}));
  await expect(createHttpApi(fetcher).flightArea!({latitude:0,longitude:0,radius_nm:100},new AbortController().signal)).rejects.toMatchObject({status:503,retryable:true,retryAt:expect.any(Number)});
});
it('fetches the global endpoint without parameters, passes cancellation, and fails shared validation', async () => {
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(globalSample())))
    .mockResolvedValueOnce(new Response(JSON.stringify({...globalSample(),trails:[{aircraft_id:'abc123',points:[{coordinates:[181,0],observed_at:'bad',callsign:null,flight_iata:null}]}]})));
  const api=createHttpApi(fetcher),controller=new AbortController();
  await expect(api.flightGlobal!(controller.signal)).resolves.toEqual(globalSample());
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/flights/global');
  expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  await expect(api.flightGlobal!(controller.signal)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});
