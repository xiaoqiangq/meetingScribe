export const NVIDIA_DIARIZATION_OPTIONS = [
    { value: 'nvidia_sortformer', label: 'Nemotron-3-Diarization（新版，最多 8 人，默认）' },
    { value: 'nvidia_sortformer_4spk', label: 'Sortformer 4spk-v2（旧版，最多 4 人）' },
] as const;

export function diarizationModelName(route: string, recordedModel?: string): string {
    const model = recordedModel || route;
    if (model === 'nvidia/Nemotron-3-Diarization' || model === 'Nemotron-3-Diarization') return 'Nemotron-3-Diarization';
    if (model === 'nvidia/diar_streaming_sortformer_4spk-v2' || model === 'diar_streaming_sortformer_4spk-v2' || model === 'nvidia_sortformer_4spk') return 'diar_streaming_sortformer_4spk-v2';
    // The compatibility route formerly loaded the four-speaker checkpoint.
    // Without result metadata, do not invent the model used by an old run.
    if (model === 'nvidia_sortformer') return 'NVIDIA diarization（未记录模型版本）';
    return model;
}

export function isNvidiaDiarizationModel(value: string): boolean {
    return NVIDIA_DIARIZATION_OPTIONS.some(option => option.value === value);
}

export function preferredNvidiaDiarization(value: string): string {
    return isNvidiaDiarizationModel(value) ? value : 'nvidia_sortformer';
}

export function speakerSelection(value: string, chunkManager: boolean, supportsCampp: boolean): string {
    if (!chunkManager && supportsCampp && value === 'funasr_campp') return value;
    return preferredNvidiaDiarization(value);
}
