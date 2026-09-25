package com.busgo.server.repository;

import com.busgo.server.dto.RouteSummaryDto;
import com.busgo.server.entity.Route;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface RouteRepository extends JpaRepository<Route, Long> {
    Optional<Route> findByName(String name);

    /**
     * Case-insensitive substring search over the route name, projected straight
     * to {@link RouteSummaryDto} (id + name) so no RouteStops are loaded. The
     * name carries the number and "origin → destination", so a query like "285"
     * matches the number and a place name matches the endpoints. Capped by the
     * caller's {@link Pageable} to keep results small.
     */
    @Query("select new com.busgo.server.dto.RouteSummaryDto(r.id, r.name) "
            + "from Route r where lower(r.name) like lower(concat('%', :q, '%')) "
            + "order by r.name asc")
    List<RouteSummaryDto> searchByName(@Param("q") String q, Pageable pageable);

    /**
     * One route with its stops eagerly fetched, for the selected-route detail
     * view. JOIN FETCH avoids the N+1 that lazy RouteStops would otherwise cause.
     */
    @Query("select distinct r from Route r "
            + "left join fetch r.routeStops rs left join fetch rs.stop "
            + "where r.id = :id")
    Optional<Route> findByIdWithStops(@Param("id") Long id);
}
