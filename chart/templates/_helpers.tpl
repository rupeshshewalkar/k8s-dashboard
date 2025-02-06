{{/* vim: set filetype=mustache: */}}
{{/*
Expand the name of the chart.
*/}}
{{- define "k8s-dashboard.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "k8s-dashboard.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "k8s-dashboard.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "k8s-dashboard.javaOpts" -}}
{{- $minRam := include "dig" (dict "map" .Values "key" "runtime.memory.minRAMPercentage" "default" 25) | float64 -}}
{{- $maxRam := include "dig" (dict "map" .Values "key" "runtime.memory.maxRAMPercentage" "default" 75) | float64 -}}
{{ $javaOpts := printf "-XX:+UseContainerSupport -XX:MinRAMPercentage=%f -XX:MaxRAMPercentage=%f -XX:+HeapDumpOnOutOfMemoryError" $minRam $maxRam }}
{{- if .Values.extraJavaOptions -}}
  {{- printf "%s %s" $javaOpts .Values.extraJavaOptions | quote -}}
{{- else -}}
  {{- $javaOpts | quote -}}
{{- end -}}
{{- end -}}

{{- define "k8s-dashboard.init-container.javaOpts" -}}
{{- $mapToCheck := index . "map" -}}
{{- $minRam := include "dig" (dict "map" $mapToCheck "key" "memory.minRAMPercentage" "default" 25) | float64 -}}
{{- $maxRam := include "dig" (dict "map" $mapToCheck "key" "memory.maxRAMPercentage" "default" 70) | float64 -}}
{{ $javaOpts := printf "-XX:+UseContainerSupport -XX:MinRAMPercentage=%f -XX:MaxRAMPercentage=%f -XX:+HeapDumpOnOutOfMemoryError" $minRam $maxRam }}
{{- if index $mapToCheck "extraJavaOptions" -}}
  {{- $extraJavaOpts := index $mapToCheck "extraJavaOptions" -}}
  {{- printf "%s %s" $javaOpts $extraJavaOpts | quote -}}
{{- else -}}
  {{- $javaOpts | quote -}}
{{- end -}}
{{- end -}}


{{- define "k8s-dashboard.vault.host" -}}
    {{- if .Values.vault -}}
      {{- printf "https://%s:%s" .Values.vault.server.host (print .Values.vault.server.port | toString) | quote -}}
    {{- end -}}
{{- end -}}

{{- define "k8s-dashboard.apm.host" -}}
    {{- if .Values.apm.server -}}
      {{- printf "http://%s:%s" .Values.apm.server.host (print .Values.apm.server.port | toString) | quote -}}
    {{- end -}}
{{- end -}}

{{- define "k8s-dashboard.bottomline.component" -}}
  {{- if .Values.component -}}
     {{- printf "%s" .Values.component | quote -}}
  {{- else -}}
    {{- "backend" }}
  {{- end -}}
{{- end -}}


{{/*
Allow creating of environment variables based on key.
This function should be called using argument dictionnary.
This function is recursive for every values that are map themselves.
i.e : {{- include "keyToEnvs" (dict "values" .Values.proxy "prefix" "proxy") | indent 10 }}
Mandatory argument : values
Optional argument : prefix
*/}}
{{- define "keyToEnvs" -}}
{{- $name := "" -}}
{{- if .prefix -}}
  {{- $name = (printf "%s_" .prefix) }}
{{- end -}}
{{- range $key, $value := .values -}}
{{- if or (kindIs "float64" $value) (kindIs "int" $value) (kindIs "bool" $value) }}
  {{- $value = $value | toString -}}
{{- end -}}
{{- if kindIs "string" $value }}
- name: {{ printf "%s%s" $name $key | upper | replace "." "_" | replace "-" "_" | quote }}
  value: {{ print $value | quote -}}
{{- end -}}
{{- if kindIs "map" $value -}}
  {{ include "keyToEnvs" (dict "values" $value "prefix" (printf "%s%s" $name $key)) }}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "dig" -}}
  {{- $mapToCheck := index . "map" -}}
  {{- $keyToFind := index . "key" -}}
  {{- $default := index . "default" -}}
  {{- $keySet := (splitList "." $keyToFind) -}}
  {{- $firstKey := first $keySet -}}
  {{- if index $mapToCheck $firstKey -}} {{/* The key was found */}}
    {{- if eq 1 (len $keySet) -}}{{/* The final key in the set implies we're done */}}
      {{- index $mapToCheck $firstKey -}}
    {{- else }}{{/* More keys to check, recurse */}}
      {{- include "dig" (dict "map" (index $mapToCheck $firstKey) "key" (join "." (rest $keySet)) "default" $default) }}
    {{- end }}
  {{- else }}{{/* The key was not found */}}
      {{- $default -}}
  {{- end }}
{{- end }}
{{/*
Common labels
*/}}
{{- define "k8s-dashboard.labels" -}}
helm.sh/chart: {{ include "k8s-dashboard.chart" . }}
{{ include "k8s-dashboard.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "k8s-dashboard.selectorLabels" -}}
app.kubernetes.io/name: {{ include "k8s-dashboard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
