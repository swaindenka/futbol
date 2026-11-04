// Match statistics tracked from simulation events. Used by the server and offline practice.

import { PHASE } from './constants.js';
import { findPlayer } from './physics.js';
import { clamp } from './util.js';

export class MatchStats {
  constructor() {
    this.players = new Map();
    this.possession = [0, 0];
    this.pendingPass = null;
  }

  ensure(meta) {
    let st = this.players.get(meta.id);
    if (!st) {
      st = {
        id: meta.id, name: meta.name, number: meta.number, team: meta.team, bot: !!meta.bot,
        goals: 0, assists: 0, shots: 0, passes: 0, passesOk: 0, tackles: 0, fouls: 0, ownGoals: 0,
      };
      this.players.set(meta.id, st);
    } else {
      st.name = meta.name;
      st.number = meta.number;
      st.team = meta.team;
    }
    return st;
  }

  tick(s) {
    if (s.phase === PHASE.PLAY && s.ball.lt >= 0) this.possession[s.ball.lt]++;
  }

  events(s, events) {
    for (const ev of events) {
      const st = ev.p !== undefined ? this.players.get(ev.p) : null;
      switch (ev.e) {
        case 'kick': {
          if (!st) break;
          this.pendingPass = null;
          const p = findPlayer(s, ev.p);
          if (!p) break;
          const dir = p.team === 0 ? 1 : -1;
          const toward = Math.cos(ev.a) * dir;
          const distGoal = Math.abs(dir * s.field.hw - p.x);
          if (toward > 0.45 && distGoal < s.field.w * 0.45) st.shots++;
          else {
            st.passes++;
            this.pendingPass = { from: ev.p, team: st.team };
          }
          break;
        }
        case 'trap': {
          const pp = this.pendingPass;
          if (pp && st && ev.p !== pp.from) {
            if (st.team === pp.team) {
              const from = this.players.get(pp.from);
              if (from) from.passesOk++;
            }
            this.pendingPass = null;
          }
          break;
        }
        case 'tackle':
          if (st) st.tackles++;
          break;
        case 'foul':
          if (st) st.fouls++;
          break;
        case 'goal': {
          if (st) {
            if (ev.own) st.ownGoals++;
            else st.goals++;
          }
          const as = ev.a >= 0 ? this.players.get(ev.a) : null;
          if (as) as.assists++;
          this.pendingPass = null;
          break;
        }
        default:
          break;
      }
    }
  }

  summary(score) {
    const total = this.possession[0] + this.possession[1];
    const poss = total > 0 ? Math.round((this.possession[0] / total) * 100) : 50;
    const winner = score[0] === score[1] ? -1 : score[0] > score[1] ? 0 : 1;
    const players = [...this.players.values()].map((p) => {
      const result = winner < 0 ? 0 : winner === p.team ? 0.5 : -0.3;
      const rating = clamp(
        6 + p.goals * 1.2 + p.assists * 0.8 + p.shots * 0.15 + p.passesOk * 0.08 + p.tackles * 0.25
          - p.fouls * 0.3 - p.ownGoals * 1 + result,
        3,
        10,
      );
      return { ...p, rating: Math.round(rating * 10) / 10 };
    });
    players.sort((a, b) => b.rating - a.rating || b.goals - a.goals);
    const mvp = players.length ? players[0].id : -1;
    return { score: [score[0], score[1]], possession: [poss, 100 - poss], players, mvp, winner };
  }
}
