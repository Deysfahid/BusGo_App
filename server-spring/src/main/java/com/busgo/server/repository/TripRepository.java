package com.busgo.server.repository;

import com.busgo.server.entity.Trip;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface TripRepository extends JpaRepository<Trip, Long> {
    List<Trip> findByStatus(String status);
    List<Trip> findByBusIdAndStatus(Long busId, String status);

    /** Active trips on one route - the buses a passenger sees when they search that route. */
    @Query("select t from Trip t join fetch t.bus join fetch t.route where t.route.id = :routeId and t.status = :status")
    List<Trip> findByRouteIdAndStatusWithBusAndRoute(@Param("routeId") Long routeId, @Param("status") String status);
    boolean existsByBusId(Long busId);

    /**
     * Loads a trip with its bus and route already initialised.
     *
     * <p>The STOMP location handler runs outside Open-Session-In-View, so the
     * geofence code must never touch an uninitialised association: a
     * {@code LazyInitializationException} there would be swallowed by the
     * messaging layer and the automatic stop advance would fail silently.</p>
     */
    @Query("select t from Trip t join fetch t.bus join fetch t.route where t.id = :id")
    Optional<Trip> findByIdWithBusAndRoute(@Param("id") Long id);
}
