variable "project_id" {
  description = "GCP project ID for production resources."
  type        = string
}

variable "region" {
  description = "Primary GCP region for production resources."
  type        = string
  default     = "asia-south1"
}

variable "firestore_location" {
  description = "Location for the Firestore database. If importing an existing database, this must match its actual location exactly."
  type        = string
  default     = "asia-south1"
}

variable "firestore_database_id" {
  description = "Firestore database ID used by ThinkSpace."
  type        = string
  default     = "thinkspace-db"
}

variable "artifact_registry_repository_id" {
  description = "Artifact Registry repository for container images."
  type        = string
  default     = "thinkspace"
}

variable "backend_service_name" {
  description = "Cloud Run service name for the backend."
  type        = string
  default     = "thinkspace-backend"
}

variable "frontend_service_name" {
  description = "Cloud Run service name for the frontend."
  type        = string
  default     = "thinkspace-frontend"
}

variable "backend_image" {
  description = "Backend container image. Defaults to the standard Artifact Registry path with the latest tag."
  type        = string
  default     = null
}

variable "frontend_image" {
  description = "Frontend container image. Defaults to the standard Artifact Registry path with the latest tag."
  type        = string
  default     = null
}

variable "session_artifacts_bucket_name" {
  description = "Globally unique bucket name for session artifacts and blobs."
  type        = string
}

variable "runtime_service_account_id" {
  description = "Service account ID used by ThinkSpace runtimes."
  type        = string
  default     = "thinkspace-runtime"
}

variable "cloud_sql_instance_name" {
  description = "Cloud SQL instance name for ADK session storage."
  type        = string
  default     = "thinkspace-adk"
}

variable "cloud_sql_database_name" {
  description = "Cloud SQL database name for ADK session storage."
  type        = string
  default     = "thinkspace_adk"
}

variable "cloud_sql_user_name" {
  description = "Application database username for ADK session storage."
  type        = string
  default     = "thinkspace_app"
}

variable "cloud_sql_tier" {
  description = "Cloud SQL machine tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "google_api_key_secret_id" {
  description = "Secret Manager secret ID for the Gemini API key."
  type        = string
  default     = "thinkspace-google-api-key"
}

variable "google_api_key_secret_version" {
  description = "Secret Manager version for the Gemini API key used by Cloud Run."
  type        = string
  default     = "latest"
}

variable "db_password_secret_id" {
  description = "Secret Manager secret ID for the ADK database password."
  type        = string
  default     = "thinkspace-adk-db-password"
}

variable "thinkspace_firestore_collection_prefix" {
  description = "Collection prefix used by the ThinkSpace Firestore-backed stores."
  type        = string
  default     = "thinkspace"
}

variable "thinkspace_agent_model" {
  description = "Primary live model for the backend orchestration flow."
  type        = string
  default     = "gemini-2.5-flash-native-audio-preview-12-2025"
}

variable "thinkspace_flashcard_model" {
  description = "Model used for flashcard generation."
  type        = string
  default     = "gemini-2.5-flash"
}

variable "thinkspace_key_moment_model" {
  description = "Model used for key moment generation."
  type        = string
  default     = "gemini-2.5-flash"
}

variable "thinkspace_canvas_visual_planner_model" {
  description = "Model used to plan static canvas visuals."
  type        = string
  default     = "gemini-2.5-flash"
}

variable "thinkspace_canvas_visual_image_model" {
  description = "Model used to render static canvas visuals."
  type        = string
  default     = "gemini-2.5-flash-image"
}

variable "backend_timeout" {
  description = "Request timeout for the backend Cloud Run service."
  type        = string
  default     = "3600s"
}

variable "frontend_timeout" {
  description = "Request timeout for the frontend Cloud Run service."
  type        = string
  default     = "300s"
}

variable "backend_min_instance_count" {
  description = "Minimum backend Cloud Run instances."
  type        = number
  default     = 1
}

variable "backend_max_instance_count" {
  description = "Maximum backend Cloud Run instances."
  type        = number
  default     = 1
}

variable "frontend_min_instance_count" {
  description = "Minimum frontend Cloud Run instances."
  type        = number
  default     = 0
}

variable "frontend_max_instance_count" {
  description = "Maximum frontend Cloud Run instances."
  type        = number
  default     = 3
}

variable "backend_max_instance_request_concurrency" {
  description = "Max request concurrency per backend instance."
  type        = number
  default     = 1
}

variable "frontend_max_instance_request_concurrency" {
  description = "Max request concurrency per frontend instance."
  type        = number
  default     = 80
}

variable "backend_cpu" {
  description = "Backend Cloud Run CPU limit."
  type        = string
  default     = "1"
}

variable "backend_memory" {
  description = "Backend Cloud Run memory limit."
  type        = string
  default     = "1Gi"
}

variable "frontend_cpu" {
  description = "Frontend Cloud Run CPU limit."
  type        = string
  default     = "1"
}

variable "frontend_memory" {
  description = "Frontend Cloud Run memory limit."
  type        = string
  default     = "512Mi"
}

variable "labels" {
  description = "Labels applied to production resources."
  type        = map(string)
  default = {
    app         = "thinkspace"
    environment = "prod"
    managed_by  = "terraform"
  }
}
