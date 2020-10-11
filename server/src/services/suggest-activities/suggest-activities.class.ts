import { Params } from '@feathersjs/feathers';
import { Service, NedbServiceOptions } from 'feathers-nedb';
import { Application } from '../../declarations';

export class SuggestActivities extends Service {
  app: Application;
  constructor(options: Partial<NedbServiceOptions>, app: Application) {
    super(options);
    this.app = app;
  }

  find (params?: Params): Promise<any> {
    if (params?.query?.now) {
      const now = new Date(params.query.now);
      return this.nearest(params, now);
    }
    
    return super.find({
      ...params,
      query: {
        ...params?.query,
        userId: params?.user._id
      }
    });
  }

  create(data: Partial<any>, params?: Params): Promise<any> {
    return super.create(Object.assign(data, {
      userId: params?.user._id
    }), params);
  }

  async nearest(params: Params, now: Date): Promise<any[]> {
    const candidates: any[] = await this.find({
      ...params,
      provider: undefined,
      paginate: false,
      query: {
        freq: { $gt: 0 },
        $sort: { time: 1 },
      }
    });

    if (candidates.length > 0) {
      const t = now.getHours() * 100 + now.getMinutes();
      return candidates.map((item: any) => Object.assign(item, {
        dt: Math.abs(t - item.time)
      })).sort(
        (a, b) => a.dt === b.dt ? a.freq - b.freq : a.dt - b.dt
      ).slice(0, Math.min(candidates.length, params.query?.$limit || 10));
    }

    await this.refresh(params);
    return await this.find({
      ...params,
      provider: undefined
    });
  }

  async refresh(params: Params): Promise<void> {
    const ticks: any[] = await this.app.service('ticks')._find({
      ...params,
      provider: undefined,
      paginate: false,
      query: {
        tickTime: { $gt: 0 },
        $sort: { tickTime: 1 },
        $select: ['activity', 'tickTime']
      }
    });

    const m = new Map<string, any>();
    for(const tick of ticks) {
      const t = new Date(tick.tickTime);
      const time = t.getHours() * 100 + t.getMinutes();
      if (m.has(tick.activity)) {
        const x = m.get(tick.activity);
        x.freq += 1;
        x.timeArray.push(time);
        m.set(tick.activity, x);
      } else {
        m.set(tick.activity, {
          activity: tick.activity,
          timeArray: [time],
          freq: 1,
        });
      }
    }

    const avg = (array: number[]) => array.reduce((a, v) => a + v, 0) / array.length;

    for (const key of m.keys()) {
      const entry = m.get(key);
      await this.create({
        activity: entry.activity,
        time: avg(entry.timeArray),
        freq: entry.freq
      });

      /*
      if (entry.timeArray.length >= 5) {
        let timeArray: number[] = [...entry.timeArray];
        let changed = false;
        do {
          const avg = timeArray.reduce((a, v) => a+v, 0) / timeArray.length;
          const std = Math.sqrt(timeArray.reduce((a, v) => a + (v - avg) * (v - avg), 0) / timeArray.length);
          
        } while (changed);
      }
      */
    }
  }
}
