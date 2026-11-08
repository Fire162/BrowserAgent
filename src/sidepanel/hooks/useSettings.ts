import { useState, useEffect } from 'react';
import { AllSettings, ProviderId } from '../../core/llm/types';
import { DEFAULT_SETTINGS } from '../../core/llm/providers/registry';
import { loadSettings, saveSettings } from '../../core/storage/db';

export function useSettings() {
  const [settings, setSettings] = useState<AllSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const updateSettings = async (newSettings: AllSettings) => {
    setSettings(newSettings);
    await saveSettings(newSettings);
  };

  const setActiveProvider = async (providerId: ProviderId) => {
    const updated = { ...settings, activeProvider: providerId };
    await updateSettings(updated);
  };

  const updateProviderConfig = async (
    providerId: ProviderId,
    updates: Partial<AllSettings['providers'][ProviderId]>
  ) => {
    const updated = {
      ...settings,
      providers: {
        ...settings.providers,
        [providerId]: {
          ...settings.providers[providerId],
          ...updates,
        },
      },
    };
    await updateSettings(updated);
  };

  const updateAgentConfig = async (updates: Partial<AllSettings['agent']>) => {
    const updated = {
      ...settings,
      agent: {
        ...settings.agent,
        ...updates,
      },
    };
    await updateSettings(updated);
  };

  return {
    settings,
    loading,
    updateSettings,
    setActiveProvider,
    updateProviderConfig,
    updateAgentConfig,
  };
}
