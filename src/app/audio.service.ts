import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class AudioService {
  private sounds: Record<string, HTMLAudioElement> = {};
  private audioContext: AudioContext | null = null;
  private useProceduralFallback: Record<string, boolean> = {};

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      // Pre-load sounds from the public/sounds directory
      this.initSound('crank', '/sounds/Metal Crank Grinding Sound.mp3');
      this.initSound('buy', '/sounds/buy.mp3');
      this.initSound('goal', '/sounds/goal.mp3');
    }
  }

  private initSound(name: string, url: string) {
    const audio = new Audio();
    audio.src = url;
    
    // Default to procedural until we know the file loaded successfully
    this.useProceduralFallback[name] = true;

    audio.addEventListener('canplaythrough', () => {
      this.useProceduralFallback[name] = false;
    });
    
    audio.addEventListener('error', () => {
      this.useProceduralFallback[name] = true;
    });

    audio.load();
    this.sounds[name] = audio;
  }

  playSound(name: string) {
    if (!isPlatformBrowser(this.platformId)) return;
    
    if (this.useProceduralFallback[name]) {
      this.playProcedural(name);
      return;
    }

    const audio = this.sounds[name];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(e => {
        console.error('Audio play failed:', e);
        this.playProcedural(name);
      });
    } else {
      this.playProcedural(name);
    }
  }

  private playProcedural(name: string) {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = this.audioContext;
    if (ctx.state === 'suspended') {
        ctx.resume();
    }
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (name === 'crank') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (name === 'buy') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else if (name === 'goal') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(554, ctx.currentTime + 0.2);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.0);
      osc.start();
      osc.stop(ctx.currentTime + 1.0);
    } else if (name === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    }
  }
}
