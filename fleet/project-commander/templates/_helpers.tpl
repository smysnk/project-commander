{{- define "project-commander.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "project-commander.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "project-commander.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "project-commander.labels" -}}
app.kubernetes.io/name: {{ include "project-commander.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "project-commander.selectorLabels" -}}
app.kubernetes.io/name: {{ include "project-commander.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "project-commander.webName" -}}
{{- printf "%s-web" (include "project-commander.fullname" .) -}}
{{- end -}}

{{- define "project-commander.controlPlaneName" -}}
{{- printf "%s-control-plane" (include "project-commander.fullname" .) -}}
{{- end -}}

{{- define "project-commander.masterSlaveServiceName" -}}
{{- printf "%s-master-slave" (include "project-commander.fullname" .) -}}
{{- end -}}

{{- define "project-commander.appImage" -}}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}

{{- define "project-commander.masterImage" -}}
{{- printf "%s:%s" .Values.masterImage.repository .Values.masterImage.tag -}}
{{- end -}}

{{- define "project-commander.webConfigMapName" -}}
{{- if .Values.web.existingConfigMap -}}
{{- .Values.web.existingConfigMap -}}
{{- else -}}
{{- printf "%s-env" (include "project-commander.webName" .) -}}
{{- end -}}
{{- end -}}

{{- define "project-commander.webSecretName" -}}
{{- if .Values.web.existingSecret -}}
{{- .Values.web.existingSecret -}}
{{- else -}}
{{- printf "%s-secret" (include "project-commander.webName" .) -}}
{{- end -}}
{{- end -}}

{{- define "project-commander.serverConfigMapName" -}}
{{- if .Values.controlPlane.existingServerConfigMap -}}
{{- .Values.controlPlane.existingServerConfigMap -}}
{{- else -}}
{{- printf "%s-server-env" (include "project-commander.controlPlaneName" .) -}}
{{- end -}}
{{- end -}}

{{- define "project-commander.serverSecretName" -}}
{{- if .Values.controlPlane.existingServerSecret -}}
{{- .Values.controlPlane.existingServerSecret -}}
{{- else -}}
{{- printf "%s-server-secret" (include "project-commander.controlPlaneName" .) -}}
{{- end -}}
{{- end -}}

{{- define "project-commander.masterConfigMapName" -}}
{{- if .Values.controlPlane.existingMasterConfigMap -}}
{{- .Values.controlPlane.existingMasterConfigMap -}}
{{- else -}}
{{- printf "%s-master-env" (include "project-commander.controlPlaneName" .) -}}
{{- end -}}
{{- end -}}

{{- define "project-commander.masterSecretName" -}}
{{- if .Values.controlPlane.existingMasterSecret -}}
{{- .Values.controlPlane.existingMasterSecret -}}
{{- else -}}
{{- printf "%s-master-secret" (include "project-commander.controlPlaneName" .) -}}
{{- end -}}
{{- end -}}

{{- define "project-commander.publicScheme" -}}
{{- default "https" .Values.global.publicScheme -}}
{{- end -}}

{{- define "project-commander.publicDomain" -}}
{{- $domain := default "" .Values.global.publicDomain -}}
{{- if $domain -}}
{{- $domain -}}
{{- else if .Values.web.ingress.host -}}
{{- .Values.web.ingress.host -}}
{{- else if gt (len (default (list) .Values.web.ingress.hosts)) 0 -}}
{{- (index .Values.web.ingress.hosts 0).host -}}
{{- end -}}
{{- end -}}

{{- define "project-commander.publicUrl" -}}
{{- printf "%s://%s" (include "project-commander.publicScheme" . | trim) (include "project-commander.publicDomain" . | trim) -}}
{{- end -}}

{{- define "project-commander.controlPlaneInternalUrl" -}}
{{- printf "http://%s:%v" (include "project-commander.controlPlaneName" .) .Values.controlPlane.serverService.port -}}
{{- end -}}

{{- define "project-commander.runtimePvcName" -}}
{{- printf "%s-runtime" (include "project-commander.controlPlaneName" .) -}}
{{- end -}}

{{- define "project-commander.defaultTlsSecretName" -}}
{{- $domain := include "project-commander.publicDomain" . | trim -}}
{{- if $domain -}}
{{- printf "tls-%s" ($domain | replace "." "-") -}}
{{- end -}}
{{- end -}}
