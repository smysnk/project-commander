package main

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

type telemetrySampler struct {
	logger     *slog.Logger
	diskTarget string
}

func newTelemetrySampler(logger *slog.Logger, cfg config) *telemetrySampler {
	diskTarget := strings.TrimSpace(cfg.ProjectPath)
	if diskTarget == "" {
		diskTarget = strings.TrimSpace(cfg.StateRoot)
	}
	if diskTarget == "" {
		diskTarget = "/"
	}
	if _, err := os.Stat(diskTarget); err != nil {
		diskTarget = filepath.Dir(diskTarget)
	}
	if strings.TrimSpace(diskTarget) == "" {
		diskTarget = "/"
	}
	return &telemetrySampler{
		logger:     logger,
		diskTarget: diskTarget,
	}
}

func defaultProcessTelemetrySample(run *slavev1.ObservedProcessRun, sampledAt string) *slavev1.ProcessTelemetrySample {
	if run == nil {
		return nil
	}
	return &slavev1.ProcessTelemetrySample{
		RunId:         strings.TrimSpace(run.GetRunId()),
		ProcessKey:    strings.TrimSpace(run.GetProcessKey()),
		Pid:           run.GetPid(),
		SampledAt:     sampledAt,
		CpuPercent:    0,
		MemoryPercent: 0,
		RssBytes:      0,
		VmsBytes:      0,
		ReadBytes:     0,
		WriteBytes:    0,
		ReadOps:       0,
		WriteOps:      0,
		OpenFds:       0,
		ThreadCount:   0,
		Status:        strings.TrimSpace(run.GetStatus()),
	}
}

func normalizeProcessStatus(statuses []string, fallback string) string {
	for _, status := range statuses {
		normalized := strings.TrimSpace(strings.ToLower(status))
		if normalized != "" {
			return normalized
		}
	}
	normalizedFallback := strings.TrimSpace(strings.ToLower(fallback))
	if normalizedFallback == "" {
		return processStatusRunning
	}
	return normalizedFallback
}

func (sampler *telemetrySampler) SampleProcessTelemetry(observedRuns []*slavev1.ObservedProcessRun) []*slavev1.ProcessTelemetrySample {
	if sampler == nil || len(observedRuns) == 0 {
		return nil
	}
	sampledAt := time.Now().UTC().Format(time.RFC3339Nano)
	samples := make([]*slavev1.ProcessTelemetrySample, 0, len(observedRuns))
	for _, run := range observedRuns {
		if run == nil || run.GetPid() <= 0 {
			continue
		}
		sample := defaultProcessTelemetrySample(run, sampledAt)
		proc, err := process.NewProcess(int32(run.GetPid()))
		if err == nil {
			if cpuPercent, cpuErr := proc.Percent(0); cpuErr == nil {
				sample.CpuPercent = cpuPercent
			}
			if memoryPercent, memoryErr := proc.MemoryPercent(); memoryErr == nil {
				sample.MemoryPercent = float64(memoryPercent)
			}
			if memoryInfo, memoryInfoErr := proc.MemoryInfo(); memoryInfoErr == nil && memoryInfo != nil {
				sample.RssBytes = int64(memoryInfo.RSS)
				sample.VmsBytes = int64(memoryInfo.VMS)
			}
			if ioCounters, ioErr := proc.IOCounters(); ioErr == nil && ioCounters != nil {
				sample.ReadBytes = int64(ioCounters.ReadBytes)
				sample.WriteBytes = int64(ioCounters.WriteBytes)
				sample.ReadOps = int64(ioCounters.ReadCount)
				sample.WriteOps = int64(ioCounters.WriteCount)
			}
			if openFds, fdErr := proc.NumFDs(); fdErr == nil && openFds >= 0 {
				sample.OpenFds = int32(openFds)
			}
			if threadCount, threadErr := proc.NumThreads(); threadErr == nil && threadCount >= 0 {
				sample.ThreadCount = int32(threadCount)
			}
			if statuses, statusErr := proc.Status(); statusErr == nil {
				sample.Status = normalizeProcessStatus(statuses, sample.GetStatus())
			}
		} else if sampler.logger != nil {
			sampler.logger.Log(context.Background(), slog.LevelDebug, "process telemetry sample fallback used", "run_id", run.GetRunId(), "pid", run.GetPid(), "error", err.Error())
		}
		samples = append(samples, sample)
	}
	sort.Slice(samples, func(i, j int) bool {
		if samples[i].GetProcessKey() != samples[j].GetProcessKey() {
			return samples[i].GetProcessKey() < samples[j].GetProcessKey()
		}
		return samples[i].GetRunId() < samples[j].GetRunId()
	})
	return samples
}

func (sampler *telemetrySampler) SampleHostTelemetry() *slavev1.HostTelemetrySample {
	if sampler == nil {
		return nil
	}
	sampledAt := time.Now().UTC().Format(time.RFC3339Nano)
	hostSample := &slavev1.HostTelemetrySample{
		SampledAt:            sampledAt,
		CpuPercent:           0,
		Load_1M:              0,
		Load_5M:              0,
		Load_15M:             0,
		MemoryTotalBytes:     0,
		MemoryUsedBytes:      0,
		MemoryAvailableBytes: 0,
		DiskTotalBytes:       0,
		DiskUsedBytes:        0,
		DiskAvailableBytes:   0,
		DiskMount:            sampler.diskTarget,
	}

	if cpuPercents, err := cpu.Percent(0, false); err == nil && len(cpuPercents) > 0 {
		hostSample.CpuPercent = cpuPercents[0]
	}
	if loadAvg, err := load.Avg(); err == nil && loadAvg != nil {
		hostSample.Load_1M = loadAvg.Load1
		hostSample.Load_5M = loadAvg.Load5
		hostSample.Load_15M = loadAvg.Load15
	}
	if memoryStats, err := mem.VirtualMemory(); err == nil && memoryStats != nil {
		hostSample.MemoryTotalBytes = int64(memoryStats.Total)
		hostSample.MemoryUsedBytes = int64(memoryStats.Used)
		hostSample.MemoryAvailableBytes = int64(memoryStats.Available)
	}
	if diskUsage, err := disk.Usage(sampler.diskTarget); err == nil && diskUsage != nil {
		hostSample.DiskTotalBytes = int64(diskUsage.Total)
		hostSample.DiskUsedBytes = int64(diskUsage.Used)
		hostSample.DiskAvailableBytes = int64(diskUsage.Free)
		hostSample.DiskMount = strings.TrimSpace(diskUsage.Path)
	}

	return hostSample
}
