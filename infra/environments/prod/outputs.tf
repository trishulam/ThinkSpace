output "artifact_registry_repository" {
  description = "Artifact Registry repository ID for ThinkSpace containers."
  value       = google_artifact_registry_repository.containers.id
}

output "artifact_registry_repository_name" {
  description = "Artifact Registry repository name."
  value       = google_artifact_registry_repository.containers.name
}

output "artifact_registry_repository_url" {
  description = "Base Artifact Registry URL for pushing images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_registry_repository_id}"
}

output "default_backend_image" {
  description = "Default backend image reference used by Cloud Run if no override is provided."
  value       = local.default_backend_image
}

output "default_frontend_image" {
  description = "Default frontend image reference used by Cloud Run if no override is provided."
  value       = local.default_frontend_image
}

output "session_artifacts_bucket_name" {
  description = "Bucket name for durable ThinkSpace artifact storage."
  value       = google_storage_bucket.session_artifacts.name
}

output "firestore_database_id" {
  description = "Provisioned Firestore database ID."
  value       = google_firestore_database.thinkspace.name
}

output "runtime_service_account_email" {
  description = "Service account email for Cloud Run services."
  value       = google_service_account.runtime.email
}

output "google_api_key_secret_id" {
  description = "Secret Manager resource ID for the Gemini API key."
  value       = google_secret_manager_secret.google_api_key.id
}

output "db_password_secret_id" {
  description = "Secret Manager resource ID for the ADK database password."
  value       = google_secret_manager_secret.db_password.id
}

output "cloud_sql_instance_connection_name" {
  description = "Cloud SQL connection name for Cloud Run integration."
  value       = google_sql_database_instance.adk.connection_name
}

output "cloud_sql_database_name" {
  description = "Cloud SQL database name for ADK session storage."
  value       = google_sql_database.adk.name
}

output "cloud_sql_user_name" {
  description = "Application database user for ADK session storage."
  value       = google_sql_user.adk.name
}

output "backend_service_name" {
  description = "Cloud Run backend service name."
  value       = google_cloud_run_v2_service.backend.name
}

output "backend_service_url" {
  description = "Cloud Run backend service URL."
  value       = google_cloud_run_v2_service.backend.uri
}

output "frontend_service_name" {
  description = "Cloud Run frontend service name."
  value       = google_cloud_run_v2_service.frontend.name
}

output "frontend_service_url" {
  description = "Cloud Run frontend service URL."
  value       = google_cloud_run_v2_service.frontend.uri
}
