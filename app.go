package main

import (
	"k8s-dashboard/handlers"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	_ "k8s.io/client-go/plugin/pkg/client/auth/oidc"
)

func main() {
	router := gin.Default()
	// Add this line to start cleanup goroutine
	go handlers.CleanupSessions()
	// Create logs directory if not exists
	if err := os.MkdirAll("logs", 0755); err != nil {
		log.Fatal("Failed to create logs directory: ", err)
	}

	// Add middleware
	router.Use(handlers.LoggingMiddleware())
	// Serve static files
	router.StaticFile("/", "./public/index.html")
	router.StaticFile("/dashboard", "./public/dashboard.html")
	router.Static("/css", "./public/css")
	router.Static("/js", "./public/js")
	router.Static("/images", "./public/images")

	// Handle kubeconfig upload
	router.POST("/upload", handlers.UploadKubeConfig)
	router.GET("/api/v1/namespaces", handlers.GetNamespaces)
	router.GET("/api/v1/deployments/namespace/:namespace", handlers.GetDeployments)
	router.POST("/api/v1/deployments/:namespace/rollout/:name", handlers.RolloutRestart)
	router.GET("/api/v1/statefulsets/namespace/:namespace", handlers.GetStatefulSets)
	router.POST("/api/v1/statefulsets/:namespace/rollout/:name", handlers.RolloutRestartStatefulSet)
	router.GET("/api/v1/pods/namespace/:namespace", handlers.GetPods)
	router.POST("/api/v1/pods/:namespace/rollout/:name", handlers.RolloutRestartPod)
	router.GET("/api/v1/authcheck", handlers.AuthCheck)
	// Serve static files from the images directory
	router.POST("/logout", handlers.Logout)

	log.Println("Server starting on :8080...")
	log.Fatal(router.Run(":8080"))
}
